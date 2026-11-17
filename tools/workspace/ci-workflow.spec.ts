import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWorkflowYaml, type YamlValue } from './workflow-yaml';

const repoRoot = path.resolve(import.meta.dirname, '../..');
type Map = { [key: string]: YamlValue };

const workflow = (name: string) =>
  parseWorkflowYaml(
    readFileSync(path.join(repoRoot, '.github/workflows', name), 'utf8'),
  ) as Map;
const map = (value: YamlValue | undefined) => value as Map;
const list = (value: YamlValue | undefined) => value as YamlValue[];
const steps = (job: Map) => list(job['steps']).map(map);
const runs = (job: Map) => steps(job).map((s) => String(s['run'] ?? ''));

/** Runs the `ci` job's shell script with the given results of the jobs it needs. */
function ciScript(results: Record<string, string>): number | null {
  const step = steps(map(map(workflow('ci.yml')['jobs'])['ci']))[0];
  const env = Object.fromEntries(
    Object.entries(map(step['env'])).map(([key, expression]) => {
      const job = /needs\.([\w-]+)\.result/.exec(String(expression))?.[1] ?? '';
      return [key, results[job] ?? ''];
    }),
  );
  return spawnSync('bash', ['-e', '-c', String(step['run'])], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  }).status;
}

describe('ci.yml (spec 003 criterion 9)', () => {
  const ci = workflow('ci.yml');
  const jobs = map(ci['jobs']);

  it('makes the ci aggregate need verify, dependency-policy and secret-scan, and run even when one fails', () => {
    const aggregate = map(jobs['ci']);

    expect(aggregate['name']).toBe('ci');
    expect(aggregate['needs']).toEqual([
      'verify',
      'dependency-policy',
      'secret-scan',
    ]);
    expect(aggregate['if']).toBe('${{ always() }}');
    // Every job of the workflow is needed by ci, so a job added later cannot fail without turning ci red.
    expect(
      Object.keys(jobs)
        .filter((name) => name !== 'ci')
        .sort(),
    ).toEqual(['dependency-policy', 'secret-scan', 'verify']);
  });

  it.skipIf(process.platform === 'win32')(
    'is green only when every needed job succeeded',
    () => {
      const all = (result: string) => ({
        verify: result,
        'dependency-policy': result,
        'secret-scan': result,
      });

      expect(ciScript(all('success'))).toBe(0);
      for (const job of ['verify', 'dependency-policy', 'secret-scan']) {
        for (const result of ['failure', 'cancelled', 'skipped', '']) {
          expect(
            ciScript({ ...all('success'), [job]: result }),
            `${job}=${result}`,
          ).not.toBe(0);
        }
      }
    },
  );

  it('runs the policy, licence and vulnerability checks in dependency-policy', () => {
    expect(runs(map(jobs['dependency-policy']))).toEqual(
      expect.arrayContaining([
        'node tools/supply-chain/cli.mjs policy',
        'node tools/supply-chain/cli.mjs licenses',
        'node tools/supply-chain/cli.mjs vulnerabilities',
      ]),
    );
  });

  it('scans every commit of the PR range in secret-scan, with full history checked out', () => {
    const job = map(jobs['secret-scan']);
    const checkout = steps(job).find((s) =>
      String(s['uses']).startsWith('actions/checkout@'),
    );

    expect(map(checkout?.['with'])['fetch-depth']).toBe('0');
    const scan = steps(job).find((s) =>
      String(s['run'] ?? '').includes('cli.mjs secrets'),
    );
    expect(String(scan?.['run'])).toContain('--log-opts "$BASE..$HEAD"');
    expect(map(scan?.['env'])['BASE']).toContain(
      'github.event.pull_request.base.sha',
    );
    expect(map(scan?.['env'])['HEAD']).toContain(
      'github.event.pull_request.head.sha',
    );
  });

  it('makes the real-gitleaks hook tests mandatory in verify', () => {
    const verify = map(jobs['verify']);

    expect(runs(verify)).toContain(
      'node tools/supply-chain/cli.mjs gitleaks-path',
    );
    const step = steps(verify).find((s) =>
      String(s['run'] ?? '').startsWith('node scripts/sdlc/verify.mjs'),
    );
    expect(map(step?.['env'])['HELMSTEAD_REQUIRE_GITLEAKS']).toBe('1');
  });

  it('keeps the workflow token read-only', () => {
    expect(ci['permissions']).toEqual({ contents: 'read' });
  });
});

describe('supply-chain-weekly.yml (spec 003 criterion 17)', () => {
  const weekly = workflow('supply-chain-weekly.yml');
  const job = map(map(weekly['jobs'])['check']);

  it('runs weekly and on manual dispatch, against main', () => {
    const on = map(weekly['on']);
    const [schedule] = list(on['schedule']).map(map);

    expect(Object.keys(on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    // minute hour day-of-month month day-of-week: one fixed weekday.
    expect(String(schedule['cron'])).toMatch(/^\d+ \d+ \* \* [0-6]$/);
    const checkout = steps(job).find((s) =>
      String(s['uses']).startsWith('actions/checkout@'),
    );
    expect(map(checkout?.['with'])).toMatchObject({
      ref: 'main',
      'fetch-depth': '0',
    });
  });

  it('has contents: read and issues: write, and nothing else', () => {
    expect(weekly['permissions']).toEqual({
      contents: 'read',
      issues: 'write',
    });
    expect(job['permissions']).toBeUndefined();
  });

  it('runs the vulnerability check, the licence check and a full-history secret scan', () => {
    const commands = runs(job).join('\n');

    expect(commands).toContain('cli.mjs vulnerabilities');
    expect(commands).toContain('cli.mjs licenses');
    expect(commands).toMatch(/cli\.mjs secrets --report/);
    expect(commands).not.toMatch(/cli\.mjs secrets[^\n]*--log-opts/);
  });

  it('opens or comments on the issue with the findings and a link to the run, then fails', () => {
    const report = steps(job).find(
      (s) => s['name'] === 'Open or update the issue',
    );
    const script = String(report?.['run']);

    expect(script).toContain('title="Weekly supply-chain check failed"');
    expect(script).toContain('gh issue comment');
    expect(script).toContain('gh issue create');
    expect(String(map(report?.['env'])['RUN_URL'])).toContain(
      'actions/runs/${{ github.run_id }}',
    );
    // The secret findings come from the redacted report file only, never from a raw log.
    expect(script).toContain('$RUNNER_TEMP/findings/secrets.txt');
    expect(steps(job).at(-1)?.['run']).toBe('exit 1');
  });
});

describe('the workflow YAML reader', () => {
  it('reads mappings, sequences, block scalars and comments', () => {
    expect(
      parseWorkflowYaml(
        [
          'a: 1 # comment',
          'b: [x, "y"]',
          'c:',
          '  - d: e',
          '    f: |',
          '      line # kept',
          '      second',
          '  - plain',
          "g: 'it''s'",
        ].join('\n'),
      ),
    ).toEqual({
      a: '1',
      b: ['x', 'y'],
      c: [{ d: 'e', f: 'line # kept\nsecond\n' }, 'plain'],
      g: "it's",
    });
  });

  it.each(['a: &anchor x', 'a: { b: c }', 'a: >\n  folded', 'a: b\n   c: d'])(
    'refuses YAML it does not support: %j',
    (source) => {
      expect(() => parseWorkflowYaml(source)).toThrow(/workflow YAML line/);
    },
  );
});
