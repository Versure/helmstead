#!/usr/bin/env node
// The one check that says whether a change is done: format, lint, test, build and the API contract
// check for every project the change affects, plus the tests of the guard rails themselves.
// Used by Claude while working, by the Stop hook and by CI. Runs the same on Windows, macOS and Linux:
// it calls Node binaries directly and uses no shell syntax.
//
// Usage:
//   node scripts/sdlc/verify.mjs [--base <ref>]   run the checks
//   node scripts/sdlc/verify.mjs --all            run every project, not only the affected ones
//   node scripts/sdlc/verify.mjs --hook           Stop hook: exit 2 with the failure on stderr
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const hook = args.includes('--hook');
const baseArg = args.indexOf('--base');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

if (hook) {
  // Only gate turns that changed code on a work branch; interviews and docs pass straight through.
  try {
    JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {}
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch === 'main' || branch === 'HEAD') process.exit(0);
  const base = existsRef('origin/main') ? 'origin/main' : 'main';
  const changed = [
    ...git('diff', '--name-only', `${base}...HEAD`).split('\n'),
    ...git('status', '--porcelain').split('\n').map((l) => l.slice(3)),
  ].filter(Boolean);
  if (!changed.some((f) => /^(apps|libs|tools)\/|^(eslint\.config\.[cm]?js|nx\.json|tsconfig\.base\.json|package\.json)$/.test(f))) process.exit(0);
}

if (!existsSync('nx.json')) {
  // Deleting nx.json must never read as "nothing to verify" in CI.
  if (process.env.CI) {
    console.error('nx.json is missing, so no check can run. Failing instead of passing.');
    process.exit(1);
  }
  console.log('No Nx workspace yet (Phase 0 has not started), so there is nothing to verify.');
  process.exit(0);
}

const base = baseArg >= 0 ? args[baseArg + 1] : existsRef('origin/main') ? 'origin/main' : 'main';
// CI checks everything: the matrix is small and a skipped project is a skipped check.
const runAll = args.includes('--all') || Boolean(process.env.CI);
const targets = ['lint', 'test', 'build', 'check'];

// The entry file of an installed package, from the `bin` it declares, so an upgrade that moves it cannot break this.
const binOf = (pkg, name = pkg) => {
  const manifest = JSON.parse(readFileSync(`node_modules/${pkg}/package.json`, 'utf8'));
  return `node_modules/${pkg}/${(typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[name]).replace(/^\.\//, '')}`;
};
const nx = binOf('nx');

const steps = [
  { name: 'guard rails (scope tags, lint boundaries)', bin: binOf('vitest'), args: ['run', '--config', 'tools/vitest.config.mts'] },
  { name: 'format check', bin: nx, args: ['format:check'] },
  // The @nx/dotnet targets build with --no-restore, so the NuGet packages are restored once, here.
  { name: 'restore NuGet packages', command: 'dotnet', args: ['restore', 'apps/core/Helmstead.Core.slnx', '--nologo'] },
  runAll
    ? { name: 'lint, test, build and contract check of all projects', bin: nx, args: ['run-many', '-t', ...targets] }
    : { name: `lint, test, build and contract check of affected projects (base ${base})`, bin: nx, args: ['affected', '-t', ...targets, `--base=${base}`] },
];

let output = '';
for (const step of steps) {
  const [file, fileArgs] = step.command ? [step.command, step.args] : [process.execPath, [step.bin, ...step.args]];
  const run = spawnSync(file, fileArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NX_DAEMON: 'false' },
  });
  const text = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  // A step that could not start (status null) counts as failed, never as skipped.
  if (run.status !== 0) {
    const failure = `FAILED: ${step.name}\n${text}${run.error ? `\n${run.error.message}` : ''}`;
    if (hook) {
      process.stderr.write(`Verification failed (node scripts/sdlc/verify.mjs). Fix this before finishing:\n${failure.slice(-6000)}`);
      process.exit(2);
    }
    console.error(output + failure);
    process.exit(run.status ?? 1);
  }
  output += `PASSED: ${step.name}\n`;
  if (!hook) console.log(text);
}
if (!hook) console.log(output);
process.exit(0);

function existsRef(ref) {
  try {
    git('rev-parse', '--verify', '--quiet', ref);
    return true;
  } catch {
    return false;
  }
}
