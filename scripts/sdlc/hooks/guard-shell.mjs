#!/usr/bin/env node
// PreToolUse hook for Bash and PowerShell. Blocks the few actions that are the owner's alone:
// merging, approving, resolving review threads, landing on main, rewriting history and changing
// GitHub protection.
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
  [/\bgh\s+(repo\s+edit|ruleset)\b/, 'Repository settings are the owner\'s to change.'],
  [/\bgh\s+label\s+(create|edit|delete)\b[^\n]*\b(risk:|needs-owner-review)/, 'Risk labels are set by the risk gate.'],
  [/\b(un)?resolveReviewThread\b/, 'Only the owner resolves review threads. Reply in the thread and leave it open.'],
];

for (const [pattern, reason] of rules) {
  if (pattern.test(cmd)) block(reason);
}

// Reading branch protection is fine; changing it is not. A `gh api` call that touches
// protection is allowed only when it is plainly a read: no method other than GET, and no
// fields or input (those make `gh api` default to POST). Spellings the checks don't
// recognise therefore fail closed.
if (/\bgh(\.exe)?\s+api\b/.test(cmd)) {
  const methods = [...cmd.matchAll(/\s(?:-X|--method)[\s=]*["']?([A-Za-z]+)/g)].map((m) => m[1].toUpperCase());
  const writes = methods.some((m) => m !== 'GET') || /\s(?:-[fF]|--field\b|--raw-field\b|--input\b)/.test(cmd);
  const restProtection = /\/(protection|rulesets)\b/.test(cmd) && writes;
  const graphqlProtection = /\bgraphql\b/.test(cmd) &&
    ((/\bmutation\b/.test(cmd) && /(BranchProtection|Ruleset)/i.test(cmd)) || /query=@/.test(cmd));
  if (restProtection || graphqlProtection) {
    block('Branch protection is the owner\'s to change. (GraphQL queries from a file are blocked too; inline the query.)');
  }
}

// Only the owner resolves review threads (docs/sdlc.md §4). Besides the mutation name above, block
// the REST routes that resolve a thread, any GraphQL write (the build needs none), and GraphQL calls
// whose query this hook cannot read: from a file, stdin, a shell variable or command substitution.
// Claude runs with the owner's account, so this guards against mistakes; it is not a security boundary.
const githubCall = /\bgh(\.exe)?\s+api\b|\bcurl\b|\bwget\b|Invoke-(RestMethod|WebRequest)\b/.test(cmd);
if (githubCall && /\/resolve\b/.test(cmd)) {
  block('Only the owner resolves review threads. Reply in the thread and leave it open.');
}
if (/\b(curl|wget)\b|Invoke-(RestMethod|WebRequest)\b/.test(cmd) && /\/graphql\b/.test(cmd)) {
  block('Call GitHub GraphQL only through `gh api graphql` with an inline query.');
}
if (/\bgh(\.exe)?\s+api\s+graphql\b/.test(cmd)) {
  if (/\bmutation\b/i.test(cmd)) block('GraphQL writes are not allowed. Use the REST API (gh api, gh pr) instead.');
  if (/--input\b|query=@|query=["']?\$|\$\(|`/.test(cmd)) {
    block('Write GraphQL queries inline as a literal (-f query=\'...\'), so the guard can read them.');
  }
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
