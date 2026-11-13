// Gets the gitleaks release pinned in tools/supply-chain/gitleaks.json and runs it. Used by the secret-scan hook
// (scripts/sdlc/hooks/scan-secrets.mjs), the `secret-scan` CI job and the weekly run, so all three use the same
// binary obtained the same way (spec 003 criteria 11 and 12).
//
// Order: a gitleaks on the PATH whose version matches the pin; else the cached copy, if its hash still matches;
// else download the release archive, verify its SHA-256 against the pin before anything is extracted or run,
// extract only the binary and cache it. Every failure throws: a caller must block, never allow.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from './policy.mjs';

export const PIN_PATH = path.join(import.meta.dirname, 'gitleaks.json');

export function loadPin(file = PIN_PATH) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The OS user cache folder, outside the repository. */
export function defaultCacheDir() {
  const home = homedir();
  const base =
    process.platform === 'win32'
      ? (process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'))
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Caches')
        : (process.env.XDG_CACHE_HOME ?? path.join(home, '.cache'));
  return path.join(base, 'helmstead');
}

export const sha256 = (buffer) =>
  createHash('sha256').update(buffer).digest('hex');

const normalizeVersion = (text) => String(text).trim().replace(/^v/, '');

function assetFor(pin, platform, arch) {
  const asset = pin.assets?.[`${platform}-${arch}`];
  if (!asset) {
    throw new Error(
      `No pinned gitleaks release for ${platform}-${arch} in tools/supply-chain/gitleaks.json (pinned: ${Object.keys(pin.assets ?? {}).join(', ')}).`,
    );
  }
  if (!/^[0-9a-f]{64}$/.test(asset.sha256 ?? '')) {
    throw new Error(
      `The pinned SHA-256 for ${platform}-${arch} is not a SHA-256 hash.`,
    );
  }
  return asset;
}

/** The version a gitleaks binary reports, or undefined when it cannot run. */
export function versionOf(binary) {
  const run = spawnSync(binary, ['version'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  return run.status === 0 ? normalizeVersion(run.stdout) : undefined;
}

function onPath(searchPath, binaryName) {
  for (const dir of (searchPath ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, binaryName);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function cachePaths(pin, asset, cacheDir, platform, arch) {
  const folder = path.join(
    cacheDir ?? defaultCacheDir(),
    'gitleaks',
    normalizeVersion(pin.version),
    `${platform}-${arch}`,
  );
  return {
    folder,
    binary: path.join(folder, asset.binary),
    marker: path.join(folder, `${asset.binary}.sha256`),
  };
}

/**
 * A gitleaks of the pinned version that is already here, without downloading: one on the PATH whose version
 * matches, or the cached copy if its hash still matches the one recorded when it was cached.
 * @returns {string | undefined}
 */
export function cachedGitleaks(options = {}) {
  const pin = options.pin ?? loadPin();
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const asset = assetFor(pin, platform, arch);

  const installed = onPath(
    options.searchPath ?? process.env.PATH,
    asset.binary,
  );
  if (installed && versionOf(installed) === normalizeVersion(pin.version))
    return installed;

  const { binary, marker } = cachePaths(
    pin,
    asset,
    options.cacheDir,
    platform,
    arch,
  );
  if (existsSync(binary) && existsSync(marker)) {
    if (readFileSync(marker, 'utf8').trim() === sha256(readFileSync(binary)))
      return binary;
    options.log?.(
      'The cached gitleaks does not match the hash recorded when it was cached; downloading it again.',
    );
  }
  return undefined;
}

/**
 * @param {{
 *   pin?: any, cacheDir?: string, searchPath?: string, platform?: string, arch?: string,
 *   download?: (url: string) => Promise<Buffer>, log?: (message: string) => void,
 * }} [options]
 * @returns {Promise<string>} the path of a gitleaks binary of the pinned version
 */
export async function ensureGitleaks(options = {}) {
  const pin = options.pin ?? loadPin();
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const asset = assetFor(pin, platform, arch);
  const log = options.log ?? (() => {});

  const found = cachedGitleaks({ ...options, pin, platform, arch, log });
  if (found) return found;

  // Not here yet: download, verify against the pin, then extract. The archive stays in memory until it is verified.
  const { folder, binary, marker } = cachePaths(
    pin,
    asset,
    options.cacheDir,
    platform,
    arch,
  );
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  let archive;
  try {
    log(`Downloading gitleaks ${pin.version} from ${asset.url}`);
    archive = await (options.download ?? downloadFile)(asset.url);
  } catch (error) {
    throw new Error(
      `Could not download gitleaks ${pin.version} (${asset.url}): ${error.message}. ` +
        'You may be offline, and there is no cached copy. Connect and try again, or install gitleaks ' +
        `${pin.version} on the PATH. The commit stays blocked until a secret scan can run.`,
    );
  }
  const actual = sha256(archive);
  const download = path.join(
    folder,
    `download-${randomUUID()}${asset.url.endsWith('.zip') ? '.zip' : '.tar.gz'}`,
  );
  if (actual !== asset.sha256) {
    // Nothing of the archive is kept, extracted or run.
    rmSync(download, { force: true });
    throw new Error(
      `The gitleaks download does not match its pinned checksum (expected ${asset.sha256}, got ${actual}). It was deleted and not run.`,
    );
  }
  const staging = mkdtempSync(path.join(folder, 'extract-'));
  try {
    writeFileSync(download, archive);
    extract(download, staging, asset.binary);
    const extracted = path.join(staging, asset.binary);
    if (!existsSync(extracted))
      throw new Error(`The archive has no ${asset.binary}.`);
    if (platform !== 'win32') chmodSync(extracted, 0o755);
    renameSync(extracted, binary);
    writeFileSync(marker, `${sha256(readFileSync(binary))}\n`);
  } finally {
    rmSync(download, { force: true });
    rmSync(staging, { recursive: true, force: true });
  }
  return binary;
}

function extract(archive, into, member) {
  // tar ships with Windows 10+ (bsdtar, which also reads zip), macOS and Linux.
  const tar =
    process.platform === 'win32'
      ? path.join(
          process.env.SystemRoot ?? 'C:\\Windows',
          'System32',
          'tar.exe',
        )
      : 'tar';
  const flags = archive.endsWith('.zip') ? '-xf' : '-xzf';
  const run = spawnSync(tar, [flags, archive, '-C', into, member], {
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    throw new Error(
      `Could not extract ${member} from the gitleaks archive: ${run.error?.message ?? run.stderr}`,
    );
  }
}

/** Downloads a URL into memory, following redirects (GitHub release assets redirect to a CDN). */
export async function downloadFile(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Runs gitleaks with this repository's .gitleaks.toml and .gitleaksignore and a JSON report, and returns the findings, already redacted. The report file lives in a fresh
 * temporary folder and is removed afterwards.
 * @returns {{ findings: { RuleID: string, File: string, StartLine: number, Commit?: string, Fingerprint?: string }[] }}
 */
export function runGitleaks(
  binary,
  args,
  { cwd = REPO_ROOT, env = process.env, configRoot = REPO_ROOT } = {},
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'helmstead-gitleaks-'));
  const report = path.join(dir, 'report.json');
  try {
    const run = spawnSync(
      binary,
      [
        ...args,
        '--no-banner',
        '--redact=100',
        '--log-level=error',
        '--exit-code=1',
        '--report-format=json',
        `--report-path=${report}`,
        `--config=${path.join(configRoot, '.gitleaks.toml')}`,
        `--gitleaks-ignore-path=${path.join(configRoot, '.gitleaksignore')}`,
      ],
      { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    if (run.status === 0) return { findings: [] };
    if (run.status === 1 && existsSync(report)) {
      const findings = JSON.parse(readFileSync(report, 'utf8') || '[]');
      // --redact already replaced the secret; drop the fields that held it anyway, so nothing downstream can print it.
      return {
        findings: findings.map(
          ({ RuleID, File, StartLine, Commit, Fingerprint }) => ({
            RuleID,
            File,
            StartLine,
            Commit,
            Fingerprint,
          }),
        ),
      };
    }
    throw new Error(
      `gitleaks failed (exit ${run.status ?? 'none'}${run.error ? `, ${run.error.message}` : ''}):\n${(run.stderr ?? '').slice(-2000)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function describeFinding(finding) {
  return `rule ${finding.RuleID} in ${finding.File} line ${finding.StartLine}${finding.Commit ? ` (commit ${finding.Commit.slice(0, 12)})` : ''}${finding.Fingerprint ? `, fingerprint ${finding.Fingerprint}` : ''}`;
}

/**
 * Scans commits (CI: the PR range; weekly: the full history) and prints the findings without their secrets.
 * @returns {Promise<number>} exit code
 */
export async function scanHistory({ logOpts, report } = {}) {
  const binary = await ensureGitleaks({ log: (m) => console.error(m) });
  const args = [
    'git',
    ...(logOpts ? [`--log-opts=${logOpts}`] : []),
    REPO_ROOT,
  ];
  const { findings } = runGitleaks(binary, args);
  const scope = logOpts ? `commits ${logOpts}` : 'the full history';
  const text =
    findings.length === 0
      ? `Secret scan passed: gitleaks ${loadPin().version} found nothing in ${scope}.`
      : [
          `Secret scan failed: gitleaks found ${findings.length} possible secrets in ${scope} (values redacted):`,
          ...findings.map((f) => `  - ${describeFinding(f)}`),
          'A secret that was ever committed must be rotated, even if a later commit removed it.',
          'A false positive goes in .gitleaksignore by fingerprint (a high-risk change the owner reviews).',
        ].join('\n');
  if (report) writeFileSync(report, `${text}\n`);
  (findings.length === 0 ? console.log : console.error)(text);
  return findings.length === 0 ? 0 : 1;
}
