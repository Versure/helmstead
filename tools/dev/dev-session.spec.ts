import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const json = (file: string) =>
  JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8'));

function* filesUnder(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.angular'].includes(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* filesUnder(full);
    else yield full;
  }
}

// Spec 004 criteria 17, 18 and 20: the development token stays out of git and out of the app.
describe('the development session token', () => {
  it('lives in .helmstead/, which git ignores', () => {
    const ignored = execFileSync(
      'git',
      ['check-ignore', '--no-index', '.helmstead/dev-session-token'],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(ignored.trim()).toBe('.helmstead/dev-session-token');
  });

  it('is never read by the code that ships: nothing under apps/web/src or libs/ uses tools/dev or the file', () => {
    const offenders = [
      ...filesUnder(path.join(repoRoot, 'apps/web/src')),
      ...filesUnder(path.join(repoRoot, 'libs')),
    ]
      .filter((file) => /\.(ts|mts|js|mjs|json|html)$/.test(file))
      .filter((file) =>
        /dev-session-token|(from|import\s*\(|require\s*\()\s*['"][^'"]*(tools\/dev|proxy\.conf)/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map((file) => path.relative(repoRoot, file));

    expect(offenders).toEqual([]);
  });

  it('is added by the dev server proxy, which the web serve target uses', () => {
    expect(
      json('apps/web/project.json').targets.serve.options.proxyConfig,
    ).toBe('apps/web/proxy.conf.mjs');
  });

  it('is made by the launcher, which the core serve target uses', () => {
    expect(
      json('apps/core/src/Helmstead.Core.Api/project.json').targets.serve
        .options.command,
    ).toBe('node tools/dev/serve-core.mjs');
  });
});
