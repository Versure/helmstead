#!/usr/bin/env node
// Runs in .github/workflows/risk-gate.yml (pull_request_target, base-branch code only).
// Sets the required `risk-gate` commit status on the PR head and decides on auto-merge:
//   `human-approved` label (any risk)              -> success, auto-merge
//   low risk + AI review pass for the head commit  -> success, auto-merge
//   anything else                                  -> failure, auto-merge off
// New commits remove `human-approved`, so an approval always covers the code that merges.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { changedFiles, changedLines, classify, title } from './classify-risk.mjs';
import { aiReviewPassSha, onlySpecFiles } from './pr-markers.mjs';

const APPROVED = 'human-approved';
const FORCE_HIGH = 'needs-owner-review';
// `review` is raised by /build when the AI review's voters split on a serious finding.
const CATEGORIES = ['security', 'architecture', 'data', 'pipeline', 'review'];

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
// A raise anywhere in the body counts, since it can only make the PR stricter.
const body = pr.body ?? '';
for (const m of body.matchAll(/<!--\s*risk:raise\s+([a-z,\s]+?)\s*-->/gi)) {
  for (const key of m[1].split(/[,\s]+/).filter((k) => CATEGORIES.includes(k))) {
    result.categories[key] ??= ['raised in the PR description'];
  }
}
if (labels.has(FORCE_HIGH)) result.categories.owner = [`label \`${FORCE_HIGH}\``];
const high = Object.keys(result.categories).length > 0;
const approved = labels.has(APPROVED);

// The AI review pass names the commit it covered. It counts only for the PR head, or for an ancestor
// of it when everything after that commit is spec files (the `status: built` commit). Any other push
// after the review leaves the PR without a pass until /build reviews it and updates the marker.
const passSha = aiReviewPassSha(body);
let aiReviewed = false;
let aiReviewNote = 'the AI review pass marker is missing';
if (passSha) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', passSha, head]);
    const after = execFileSync('git', ['diff', '--name-only', '--no-renames', passSha, head], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    aiReviewed = onlySpecFiles(after);
    if (!aiReviewed) aiReviewNote = `commits after the reviewed ${passSha.slice(0, 7)} were not reviewed`;
  } catch {
    aiReviewNote = `the reviewed commit ${passSha.slice(0, 7)} is not in this PR's history`;
  }
}

const names = Object.keys(result.categories).map(title).join(', ');
let state;
let description;
if (approved) [state, description] = ['success', high ? `High risk (${names}), approved by owner` : 'Low risk, approved by owner'];
else if (high) [state, description] = ['failure', `Needs owner review: ${names}. Add label ${APPROVED} when done.`];
else if (aiReviewed) [state, description] = ['success', 'Low risk, AI review passed'];
else [state, description] = ['failure', `Low risk, but ${aiReviewNote}. Re-run /build, or add label ${APPROVED}.`];

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
