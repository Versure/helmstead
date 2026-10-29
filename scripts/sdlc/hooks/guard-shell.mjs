#!/usr/bin/env node
// PreToolUse hook for Bash and PowerShell. Blocks the few actions that are the owner's alone:
// merging, approving, landing on main, rewriting history and changing GitHub protection.
// Exit code 2 blocks the command and sends stderr back to Claude.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {}
const cmd = String(input.tool_input?.command ?? '');

const rules = [
  [/\bgh\s+pr\s+merge\b/, 'Merging is done by the risk gate (low risk) or by the owner (high risk). Open the PR and stop.'],
  [/human-approved/, 'Only the owner gives the human-approved label.'],
  [/\bgh\s+pr\s+review\b[^\n]*--approve/, 'Claude does not approve pull requests.'],
  [/\bgit\s+push\b[^\n;&|]*(\s-f\b|--force(?!-with-lease))/, 'Force pushes are not allowed. Use --force-with-lease on your own work branch if you must.'],
  [/\bgit\s+push\b[^\n;&|]*[\s:+](refs\/heads\/)?(main|master)(?=\s|$|[;&|])/, 'Never push to main. Push your work branch and open a PR.'],
  [/--no-verify\b/, 'Do not skip git hooks.'],
  [/\bgh\s+api\b[^\n]*\/(protection|rulesets)\b/, 'Branch protection is the owner\'s to change.'],
  [/\bgh\s+(repo\s+edit|ruleset)\b/, 'Repository settings are the owner\'s to change.'],
  [/\bgh\s+label\s+(create|edit|delete)\b[^\n]*\b(risk:|needs-owner-review)/, 'Risk labels are set by the risk gate.'],
];

for (const [pattern, reason] of rules) {
  if (pattern.test(cmd)) block(reason);
}

if (/\bgit\s+(commit|push)\b/.test(cmd)) {
  let branch = '';
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', cwd: input.cwd || process.cwd() }).trim();
  } catch {}
  if (branch === 'main' || branch === 'master') {
    block('Do not commit or push on main. Create a work branch first (feat/NNN-slug, fix/NNN-slug or chore/slug).');
  }
}

process.exit(0);

function block(reason) {
  process.stderr.write(`Blocked by scripts/sdlc/hooks/guard-shell.mjs: ${reason}\n`);
  process.exit(2);
}
