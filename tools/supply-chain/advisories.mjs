// The online vulnerability check of spec 003 (criteria 7 and 8). It reads `npm audit --json` and
// `dotnet list package --vulnerable --include-transitive --format json`, and fails on every high or critical
// advisory, in shipped and tooling dependencies alike, unless dependency-policy.json has a current exception for
// that ecosystem, package and advisory. An expired exception fails on its own, so stale entries get removed.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './policy.mjs';

/**
 * @typedef {{
 *   ecosystem: 'npm' | 'nuget',
 *   package: string,
 *   version: string | undefined,
 *   advisory: string,
 *   severity: string,
 *   title: string | undefined,
 *   url: string | undefined,
 *   where: string[],
 * }} Advisory
 */

const FAILING = new Set(['high', 'critical']);

/** The GHSA ID from an advisory URL, or the URL itself when it has none. */
function advisoryId(url, fallback) {
  return (
    /\b(GHSA(?:-[a-z0-9]{4}){3})\b/i.exec(url ?? '')?.[1] ??
    (url || String(fallback))
  );
}

/**
 * @param {any} audit parsed `npm audit --json` output (auditReportVersion 2)
 * @param {any} [lock] parsed package-lock.json, to name the installed versions
 * @returns {Advisory[]}
 */
export function parseNpmAudit(audit, lock) {
  if (audit?.error) {
    throw new Error(
      `npm audit failed: ${audit.error.code ?? ''} ${audit.error.summary ?? ''}`.trim(),
    );
  }
  if (
    audit?.auditReportVersion !== 2 ||
    typeof audit.vulnerabilities !== 'object'
  ) {
    throw new Error(
      'The input is not npm audit --json output (auditReportVersion 2).',
    );
  }
  const advisories = [];
  for (const entry of Object.values(audit.vulnerabilities)) {
    const versions = [
      ...new Set(
        (entry.nodes ?? [])
          .map((node) => lock?.packages?.[node]?.version)
          .filter(Boolean),
      ),
    ];
    // String entries in `via` point at another package's advisory; that package is listed with it itself.
    for (const via of entry.via ?? []) {
      if (typeof via !== 'object') continue;
      advisories.push({
        ecosystem: 'npm',
        package: via.name ?? entry.name,
        version: versions.length > 0 ? versions.join(', ') : undefined,
        advisory: advisoryId(via.url, via.source),
        severity: String(via.severity ?? entry.severity).toLowerCase(),
        title: via.title,
        url: via.url,
        where: entry.nodes ?? [],
      });
    }
  }
  return advisories;
}

/**
 * @param {any} report parsed `dotnet list package --vulnerable --include-transitive --format json` output
 * @returns {Advisory[]}
 */
export function parseDotnetList(report) {
  if (report?.version !== 1 || !Array.isArray(report.projects)) {
    throw new Error(
      'The input is not dotnet list package --format json output (version 1).',
    );
  }
  const errors = (report.problems ?? []).filter(
    (problem) => String(problem.level).toLowerCase() === 'error',
  );
  if (errors.length > 0) {
    throw new Error(
      `dotnet list package reported errors:\n${errors.map((p) => `  ${p.project ?? ''} ${p.text}`).join('\n')}`,
    );
  }
  const byKey = new Map();
  for (const project of report.projects) {
    for (const framework of project.frameworks ?? []) {
      for (const pkg of [
        ...(framework.topLevelPackages ?? []),
        ...(framework.transitivePackages ?? []),
      ]) {
        for (const vulnerability of pkg.vulnerabilities ?? []) {
          const advisory = advisoryId(vulnerability.advisoryurl);
          const key = `${pkg.id.toLowerCase()}@${pkg.resolvedVersion} ${advisory}`;
          const where = path.basename(project.path ?? '');
          const existing = byKey.get(key);
          if (existing) {
            if (!existing.where.includes(where)) existing.where.push(where);
            continue;
          }
          byKey.set(key, {
            ecosystem: 'nuget',
            package: pkg.id,
            version: pkg.resolvedVersion,
            advisory,
            severity: String(vulnerability.severity).toLowerCase(),
            title: undefined,
            url: vulnerability.advisoryurl,
            where: [where],
          });
        }
      }
    }
  }
  return [...byKey.values()];
}

/** Exceptions are valid through their `expires` day (UTC). */
function isExpired(exception, today) {
  return exception.expires < today;
}

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** @returns {Advisory[]} the high and critical advisories without a current exception */
export function checkAdvisories(advisories, policy, today = todayUtc()) {
  return advisories.filter(
    (advisory) =>
      FAILING.has(advisory.severity) &&
      !policy.vulnerabilityExceptions.some(
        (exception) =>
          !isExpired(exception, today) &&
          exception.ecosystem === advisory.ecosystem &&
          (advisory.ecosystem === 'nuget'
            ? exception.package.toLowerCase() === advisory.package.toLowerCase()
            : exception.package === advisory.package) &&
          exception.advisory.toLowerCase() === advisory.advisory.toLowerCase(),
      ),
  );
}

/** Every exception past its expiry date, whether or not its advisory still exists. */
export function expiredExceptions(policy, today = todayUtc()) {
  return policy.vulnerabilityExceptions.filter((exception) =>
    isExpired(exception, today),
  );
}

export function formatAdvisoryReport({ failing, expired }) {
  const lines = [];
  for (const a of failing) {
    lines.push(
      `${a.ecosystem} package ${a.package}${a.version ? `@${a.version}` : ''}: ${a.severity} advisory ${a.advisory}${a.title ? ` (${a.title})` : ''}`,
      ...(a.url ? [`  ${a.url}`] : []),
      `  In: ${a.where.join(', ') || '(unknown)'}`,
      `  Upgrade it. If it cannot be fixed yet, add this to "vulnerabilityExceptions" in dependency-policy.json (a high-risk change the owner reviews):`,
      `    ${JSON.stringify({ ecosystem: a.ecosystem, package: a.package, advisory: a.advisory, reason: '<why it is not exploitable here>', expires: '<YYYY-MM-DD>' })}`,
    );
  }
  for (const e of expired) {
    lines.push(
      `Exception for ${e.ecosystem} package ${e.package}, advisory ${e.advisory}, expired on ${e.expires}.`,
      `  Remove it from dependency-policy.json, or renew it with a new date and reason if the advisory still applies.`,
    );
  }
  return lines.join('\n');
}

function runJson(command, args) {
  const windows = process.platform === 'win32';
  const run = spawnSync(
    windows && command === 'npm' ? 'npm.cmd' : command,
    args,
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: windows && command === 'npm',
    },
  );
  if (run.error)
    throw new Error(
      `${command} ${args.join(' ')} could not start: ${run.error.message}`,
    );
  try {
    return JSON.parse(run.stdout);
  } catch {
    // npm audit exits 1 when it finds anything, so the exit code alone says nothing; output that is not JSON does.
    throw new Error(
      `${command} ${args.join(' ')} did not print JSON (exit ${run.status}):\n${(run.stderr || run.stdout).slice(-2000)}`,
    );
  }
}

/** Runs both audits (or reads saved output) and prints the result. @returns {number} exit code */
export function runVulnerabilityCheck(policy, npmAuditFile, dotnetListFile) {
  const lock = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'),
  );
  const npmAudit = npmAuditFile
    ? JSON.parse(readFileSync(npmAuditFile, 'utf8'))
    : runJson('npm', ['audit', '--json']);
  const dotnetList = dotnetListFile
    ? JSON.parse(readFileSync(dotnetListFile, 'utf8'))
    : runJson('dotnet', [
        'list',
        'apps/core/Helmstead.Core.slnx',
        'package',
        '--vulnerable',
        '--include-transitive',
        '--format',
        'json',
      ]);
  const advisories = [
    ...parseNpmAudit(npmAudit, lock),
    ...parseDotnetList(dotnetList),
  ];
  const failing = checkAdvisories(advisories, policy);
  const expired = expiredExceptions(policy);
  if (failing.length > 0 || expired.length > 0) {
    console.error(
      `Vulnerability check failed: ${failing.length} high or critical advisories without a current exception, ${expired.length} expired exceptions.\n`,
    );
    console.error(formatAdvisoryReport({ failing, expired }));
    return 1;
  }
  const below = advisories.filter((a) => !FAILING.has(a.severity)).length;
  console.log(
    `Vulnerability check passed: no high or critical advisory without a current exception (${advisories.length} advisories found, ${below} below high).`,
  );
  return 0;
}
