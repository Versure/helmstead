#!/usr/bin/env node
// Runs in .github/workflows/risk-gate.yml (pull_request_target, base-branch code only).
// Sets the required `risk-gate` commit status on the PR head and decides on auto-merge:
//   `human-approved` label (any risk)              -> success, auto-merge
//   low risk + AI review pass for the head commit  -> success, auto-merge
//     (only for a PR from this repository by an owner, member or collaborator; any other PR is high risk)
//   anything else                                  -> failure, auto-merge off
// The approval is recorded on the commit it covers (an `owner-approval` status), so an approval always
// covers the code that merges: on any other head the label is removed.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { changedFiles, changedLines, classify, title } from './classify-risk.mjs';
import { aiReviewPassSha, onlyStatusBuilt, trustedAuthor } from './pr-markers.mjs';

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

const base = pr.base.sha;
const head = pr.head.sha;

// The owner's approval covers one commit, and the newest decision about that commit wins.
// - The owner (or an admin) adds the label: this run posts an `owner-approval` success status on the
//   commit the PR had at that moment, naming the commit.
// - Anyone else adds it, or anyone removes it: this run posts a failure status, so an approval that was
//   withdrawn stays withdrawn, whoever adds the label next.
// The gate then reads only the newest `owner-approval` status posted by the workflow's bot on the head.
// The label alone is never trusted: event payloads are snapshots and runs can overlap. Label events run
// in their own concurrency group (risk-gate.yml), so another event cannot cancel them before they post.
const APPROVAL_CONTEXT = 'owner-approval';
const BOT = 'github-actions[bot]';
const short = head.slice(0, 7);
const postApproval = (state, description) =>
  gh('api', '-X', 'POST', `repos/${repo}/statuses/${head}`,
    '-f', `state=${state}`, '-f', `context=${APPROVAL_CONTEXT}`, '-f', `description=${description.slice(0, 140)}`);
if (event.label?.name === APPROVED && event.action === 'labeled') {
  const sender = event.sender?.login ?? '';
  const isOwner = sender !== '' && sender === event.repository?.owner?.login;
  const permission = isOwner ? 'admin' : tryGh('api', `repos/${repo}/collaborators/${sender}/permission`, '-q', '.permission')?.trim();
  if (permission === 'admin') postApproval('success', `${short} approved by ${sender}`);
  else postApproval('failure', `Label added by ${sender || 'unknown'}, who cannot approve`);
}
if (event.label?.name === APPROVED && event.action === 'unlabeled') {
  postApproval('failure', `Approval of ${short} withdrawn by ${event.sender?.login ?? 'unknown'}`);
}

// Newest `owner-approval` status by the bot on the head: 'success', 'failure', 'none', or null when it
// could not be read. `--paginate` reads every page; GitHub lists statuses newest first.
const readApproval = () => {
  const out = tryGh('api', '--paginate', `repos/${repo}/commits/${head}/statuses`,
    '--jq', `.[] | select(.context == "${APPROVAL_CONTEXT}" and .creator.login == "${BOT}") | .state`);
  if (out === null) return null;
  return out.split('\n').find(Boolean) ?? 'none';
};

const labels = new Set(pr.labels.map((l) => l.name));
let approvalNote = '';
if (labels.has(APPROVED)) {
  const approval = readApproval();
  if (approval === null) {
    // Fail safe, but keep the owner's label: the read failed, not the approval.
    labels.delete(APPROVED);
    approvalNote = 'could not read the owner approval; re-run the gate';
  } else if (approval !== 'success') {
    tryGh('pr', 'edit', String(pr.number), '--repo', repo, '--remove-label', APPROVED);
    labels.delete(APPROVED);
    approvalNote = approval === 'none'
      ? `the approval label is not for ${short}; add it again to approve this commit`
      : `the approval of ${short} was withdrawn or not given by the owner`;
  }
}

execFileSync('git', ['fetch', '--no-tags', 'origin', `+refs/pull/${pr.number}/head:refs/remotes/pr/head`]);
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
// Anyone can open a PR on a public repository and write any description, so the AI review marker only
// counts on a PR from this repository by an author with write access. Any other PR waits for the owner.
if (!trustedAuthor(pr, repo)) {
  result.categories.owner ??= [];
  result.categories.owner.push(`PR by ${pr.user?.login ?? 'unknown'} from ${pr.head?.repo?.full_name ?? 'a deleted fork'}`);
}
const high = Object.keys(result.categories).length > 0;
const approved = labels.has(APPROVED);

// The AI review pass names the commit it covered. It counts only for the PR head, or for an ancestor
// of it when the only change after it is one spec's `status:` line going from approved to built (the
// build's last commit). Any other push after the review leaves the PR without a pass until /build
// reviews it and updates the marker.
const passSha = aiReviewPassSha(body);
let aiReviewed = false;
let aiReviewNote = 'the AI review pass marker is missing (it must be among the last lines, below any footer)';
if (passSha) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', passSha, head]);
    const after = execFileSync('git', ['diff', '-U0', '--no-renames', '--no-color', passSha, head], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    aiReviewed = onlyStatusBuilt(after);
    if (!aiReviewed) aiReviewNote = `commits after the reviewed ${passSha.slice(0, 7)} were not reviewed`;
  } catch {
    aiReviewNote = `the reviewed commit ${passSha.slice(0, 7)} is not in this PR's history`;
  }
}

const names = Object.keys(result.categories).map(title).join(', ');
let state;
let description;
if (approved) [state, description] = ['success', high ? `High risk (${names}), approved by owner` : 'Low risk, approved by owner'];
else if (high) [state, description] = ['failure', approvalNote ? `Needs owner review: ${approvalNote}.` : `Needs owner review: ${names}. Add label ${APPROVED} when done.`];
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
