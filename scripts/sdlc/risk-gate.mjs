#!/usr/bin/env node
// Runs in .github/workflows/risk-gate.yml (pull_request_target, base-branch code only).
// Sets the required `risk-gate` commit status on the PR head and decides on auto-merge:
//   low risk  + AI review marker      -> success, auto-merge
//   high risk + `human-approved` label -> success, auto-merge
//   anything else                      -> failure, auto-merge off
// New commits remove `human-approved`, so an approval always covers the code that merges.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { changedFiles, changedLines, classify, title } from './classify-risk.mjs';

const APPROVED = 'human-approved';
const FORCE_HIGH = 'needs-owner-review';
const CATEGORIES = ['security', 'architecture', 'data', 'pipeline'];

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const pr = event.pull_request;
const repo = process.env.GITHUB_REPOSITORY;
const runUrl = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
const tryGh = (...args) => {
  try {
    return gh(...args);
  } catch (err) {
    console.warn(`gh ${args.join(' ')} failed: ${err.stderr || err.message}`);
    return null;
  }
};

const labels = new Set(pr.labels.map((l) => l.name));
if (event.action === 'synchronize' && labels.has(APPROVED)) {
  tryGh('pr', 'edit', String(pr.number), '--repo', repo, '--remove-label', APPROVED);
  labels.delete(APPROVED);
}

execFileSync('git', ['fetch', '--no-tags', 'origin', `+refs/pull/${pr.number}/head:refs/remotes/pr/head`]);
const base = pr.base.sha;
const head = pr.head.sha;
const result = classify(changedFiles(base, head), changedLines(base, head));

// Raises only: from the PR body (written by the build agent) and from the owner's label.
const body = pr.body ?? '';
for (const m of body.matchAll(/<!--\s*risk:raise\s+([a-z,\s]+?)\s*-->/gi)) {
  for (const key of m[1].split(/[,\s]+/).filter((k) => CATEGORIES.includes(k))) {
    result.categories[key] ??= ['raised in the PR description'];
  }
}
if (labels.has(FORCE_HIGH)) result.categories.owner = [`label \`${FORCE_HIGH}\``];
const high = Object.keys(result.categories).length > 0;
const aiReviewed = /<!--\s*ai-review:\s*pass\s*-->/i.test(body);
const approved = labels.has(APPROVED);

const names = Object.keys(result.categories).map(title).join(', ');
let state;
let description;
if (high && approved) [state, description] = ['success', `High risk (${names}), approved by owner`];
else if (high) [state, description] = ['failure', `Needs owner review: ${names}. Add label ${APPROVED} when done.`];
else if (aiReviewed) [state, description] = ['success', 'Low risk, AI review passed'];
else [state, description] = ['failure', 'Low risk, but the AI review marker is missing'];

tryGh('label', 'create', high ? 'risk:high' : 'risk:low', '--repo', repo, '--force',
  '--color', high ? 'B60205' : '0E8A16', '--description', 'Set by the risk gate');
tryGh('pr', 'edit', String(pr.number), '--repo', repo,
  '--add-label', high ? 'risk:high' : 'risk:low', '--remove-label', high ? 'risk:low' : 'risk:high');

gh('api', '-X', 'POST', `repos/${repo}/statuses/${head}`,
  '-f', `state=${state}`, '-f', 'context=risk-gate',
  '-f', `description=${description.slice(0, 140)}`, '-f', `target_url=${runUrl}`);

if (state === 'success' && !pr.draft) {
  tryGh('pr', 'merge', String(pr.number), '--repo', repo, '--auto', '--squash');
} else {
  tryGh('pr', 'merge', String(pr.number), '--repo', repo, '--disable-auto');
}

const summary = [
  `## Risk gate: ${high ? 'HIGH' : 'low'} — ${state}`,
  '',
  description,
  '',
  ...Object.entries(result.categories).flatMap(([key, hits]) => [
    `### ${title(key)}`,
    ...hits.map((f) => `- \`${f}\``),
    '',
  ]),
  `${result.files.length} files, ${result.lines} changed lines.`,
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
