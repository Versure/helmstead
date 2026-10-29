#!/usr/bin/env node
// The one check that says whether a change is done: lint, test and build for every
// project the change affects. Used by Claude while working, by the Stop hook and by CI.
//
// Usage:
//   node scripts/sdlc/verify.mjs [--base <ref>]   run the checks
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
  if (!changed.some((f) => /^(apps|libs)\//.test(f))) process.exit(0);
}

if (!existsSync('nx.json')) {
  console.log('No Nx workspace yet (Phase 0 has not started), so there is nothing to verify.');
  process.exit(0);
}

const base = baseArg >= 0 ? args[baseArg + 1] : existsRef('origin/main') ? 'origin/main' : 'main';
const run = spawnSync('npx', ['nx', 'affected', '-t', 'lint', 'test', 'build', `--base=${base}`], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 64 * 1024 * 1024,
});
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

if (run.status === 0) {
  if (!hook) console.log(output);
  process.exit(0);
}
if (hook) {
  process.stderr.write(`Verification failed (node scripts/sdlc/verify.mjs). Fix this before finishing:\n${output.slice(-6000)}`);
  process.exit(2);
}
console.error(output);
process.exit(run.status ?? 1);

function existsRef(ref) {
  try {
    git('rev-parse', '--verify', '--quiet', ref);
    return true;
  } catch {
    return false;
  }
}
