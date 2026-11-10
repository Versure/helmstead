---
name: build
description: Implement an approved spec from docs/specs/ end to end without the owner - tests first, verification, independent review, risk classification - and open a pull request whose description tells the owner exactly which parts, if any, need their review.
argument-hint: <spec number, e.g. 007> [extra instructions, e.g. "address the PR comments"]
disable-model-invocation: true
---

Build the spec: $ARGUMENTS

You work alone from here. The owner is not watching and only sees the pull request. Do not merge and do not add `human-approved`; both are the owner's (a hook blocks them).

## 1. Set up

- Find `docs/specs/NNN-*.md` for the number given. It must have `status: approved`; if not, stop and tell the owner to run `/spec` first.
- Work on the branch in its `branch:` field. If it exists on the remote, check it out; otherwise create it from `origin/main`. Run `git fetch origin` and rebase onto `origin/main` if it moved.
- If a PR for this branch already exists, this is a follow-up round. Read its description: the `<!-- ai-review-head: <sha> -->` marker is the last commit the review covered, and the "Findings ledger" block lists every finding already decided. Restore that block to `.sdlc/findings.md`; in step 4 you review only `git diff <sha>..HEAD` and never raise a ledger finding again. If you rebased and that commit is no longer an ancestor (`git merge-base --is-ancestor <sha> HEAD` fails), review the whole branch diff instead, still with the ledger.
- If the arguments ask you to address PR comments, read them first: `gh pr view --comments` and `gh api repos/{owner}/{repo}/pulls/<n>/comments`. Each comment is a requirement for this round, and each gets an answer (step 6).
- Read the spec, the files under "Notes for the build", and the code you will change.

## 2. When the spec doesn't say

If a gap affects the domain model, what is stored, a security boundary, a public contract or a new dependency, stop and ask the owner with AskUserQuestion. Those calls are theirs. For anything else, choose the option that fits the plan and the existing code, and write it down for the PR's "Decisions I made" list.

## 3. Build, test first

For each acceptance criterion, in order:

1. Write the test that checks it and run it. Confirm it fails for the right reason.
2. Implement the smallest change that makes it pass, following the patterns already in the code.
3. Run `node scripts/sdlc/verify.mjs` and fix what it reports.
4. Commit: one logical change per commit, Conventional Commits.

For criteria checked by a screenshot, run the app, capture it, and compare it with the mockup the spec links to. Keep the evidence for the PR.

The Stop hook runs `verify.mjs` whenever you try to finish with code changes on this branch, so a red build sends you back to work.

## 4. Independent review: find, vote, fix

Reviewers find candidates; independent voters decide which ones are real. Nothing is fixed on one agent's word. `REVIEW.md` says what counts as a finding.

### 4a. Find

1. Write the diff for the reviewers: `mkdir -p .sdlc && git diff origin/main...HEAD > .sdlc/review.diff`. In a follow-up round, write only what changed since the last review instead (`git diff <ai-review-head>..HEAD`), and give every reviewer the ledger.
2. Classify it: `node scripts/sdlc/classify-risk.mjs --json > .sdlc/risk.json`.
3. Start the reviewers in parallel, giving each the spec path, `.sdlc/review.diff` and `.sdlc/risk.json`:
   - `spec-reviewer`, always
   - `bug-hunter`, always
   - `security-reviewer` when the categories include `security` or `pipeline`, or when the change handles input from outside the app, runs processes, or touches files outside the app data directory
   - `architecture-reviewer` for `architecture`, or when the change adds a project, crosses the shell/core/web boundaries, or changes a shared type
   - `data-reviewer` for `data`, or when the change reads or writes stored data

### 4b. Collect

Write every finding into the ledger `.sdlc/findings.md`, one row each: ID (`F1`, `F2`, …), reviewer, severity, origin, `path:line`, the claim. Then:

- Merge duplicates (same lines, same problem) into one row that lists every reviewer that raised it.
- Drop findings about style, naming, formatting or cleanup, and findings without a `path:line`. Mark them `dropped` in the ledger with the reason; they are not voted on.

### 4c. Vote

For every remaining finding, start three `finding-verifier` agents in parallel, one per lens (`trace`, `refute`, `test`). Start all findings' voters at once. Give each voter only the finding's ID and line, its lens, the spec path, `.sdlc/review.diff` and `REVIEW.md`: not the reviewer's full report, not your opinion and not the other votes.

Tally each finding:

| Votes | Verdict |
|---|---|
| two or three `real` | **confirmed** |
| two or three `not-real` | **rejected** |
| anything else | **disputed** |

Severity and origin are what the majority of voters said, not what the reviewer said; on a three-way split, take the most severe and `new`. A finding from `security-reviewer` that is `blocker` or `major` is rejected only when no voter said `real`; otherwise it is at least disputed. Record the votes, the verdict and the voters' evidence in the ledger.

### 4d. Fix

- **Confirmed and `new`**: fix it, most severe first. Each confirmed finding names a kind of mistake: search the diff for the same mistake elsewhere and fix every instance, not only the line reported. Add or tighten the test that would have caught it.
- **Confirmed and `pre-existing`**: do not fix it in this branch unless the spec covers that code. It goes in the PR under "Pre-existing".
- **Disputed**: do not fix it. It goes in the PR under "Open findings" with the votes. A disputed `security-reviewer` finding also goes in Owner review focus and raises `security`.
- **Rejected** and **dropped**: nothing; they stay in the ledger so no later round raises them again.

Re-run `node scripts/sdlc/verify.mjs` after the fixes and commit them.

### 4e. Second round, on the fixes only

Run a second round only if you fixed a `blocker` or `major` finding, or the fixes changed more than about 50 lines. Write only the fix commits to `.sdlc/review.diff` (`git diff <head before the fixes>..HEAD`), and give the reviewers that raised confirmed findings that diff plus the ledger. Collect, vote and fix their new findings the same way.

Stop after two rounds. Anything still open goes in the PR. If the second round confirms a new `blocker`, the approach may be wrong rather than the lines: say so under "Open findings" instead of patching again.

## 5. Decide the risk

The final risk is the classifier's categories, plus every category a reviewer raised, plus any you judge applies after building it. You can add categories, never remove one. If any category remains, the PR is high risk.

## 6. Open the pull request

Write `.sdlc/pr-body.md` following `.github/pull_request_template.md`:

- **Owner review focus** (high risk only): collect the reviewers' focus items, merge duplicates and keep the list short (aim for five or fewer). Each item is a `path:start-end` link to the exact lines, why it is risky, and one concrete question the owner can answer by reading those lines. Point at the lines where the risky decision is made, not at whole files. For low risk, write "None — low risk".
- **Safe to skim**: every other changed file, one line each on what changed.
- Add `<!-- risk:raise <category> -->` for each category you or the reviewers raised that the path classifier missed.
- **AI review**: start with the counts (`N found · N confirmed and fixed · N pre-existing · N disputed · N rejected`), then the verdict per reviewer. List each pre-existing and disputed finding with its `path:line`, the claim and the votes (e.g. `2 real, 1 unsure`). Leave rejected and dropped findings out; say "nothing to fix" plainly when that is the result.
- **Findings ledger**: paste `.sdlc/findings.md` inside a collapsed `<details><summary>Findings ledger</summary>` block, so a later round knows what was decided. Add `<!-- ai-review-head: <sha> -->` with the commit the review covered.
- **How to revert**: what reverting the squash commit undoes, and anything it does not (a migration that already ran, a generated config, stored data in a new shape). "Revert the commit" is enough when that is all.
- **Escaped bug** (fix specs only): what the review did not have in front of it, and the check you added so it is caught next time: a test, a lint rule, or a line in `REVIEW.md` or `CLAUDE.md`. Add that check in this branch.
- Add `<!-- ai-review: pass -->` only if no confirmed `new` finding is open and no `security-reviewer` finding is disputed. Pre-existing and other disputed findings do not hold it back; they are listed for the owner.
- Paste the verify command with the tail of its output as evidence, and attach screenshots if the spec asked for them.

Set the spec's `status: built` in the same branch and commit it.

Push the branch and open the PR (or update its description if it exists):

```bash
git push -u origin HEAD
gh pr create --base main --title "<type>(<scope>): <spec title>" --body-file .sdlc/pr-body.md
```

In a follow-up round, answer every PR comment in its own thread: what you changed and the commit, or why you did not change it. Resolve the threads you fixed; leave the ones you disagree with open for the owner. Branch protection requires every thread to be resolved before the merge.

## 7. Report

Tell the owner, in a few lines: the PR link, low or high risk, and what they need to do. That is nothing for low risk (it merges itself when CI is green), or the review-focus items and "add the `human-approved` label when you're satisfied" for high risk.
