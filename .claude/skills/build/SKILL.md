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
- If the arguments ask you to address PR comments, read them first: `gh pr view --comments` and `gh api repos/{owner}/{repo}/pulls/<n>/comments`. Each comment is a requirement for this round.
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

## 4. Independent review

1. Write the diff for the reviewers: `mkdir -p .sdlc && git diff origin/main...HEAD > .sdlc/review.diff`.
2. Classify it: `node scripts/sdlc/classify-risk.mjs --json > .sdlc/risk.json`.
3. Start the reviewers in parallel, giving each the spec path, `.sdlc/review.diff` and `.sdlc/risk.json`:
   - `spec-reviewer`, always
   - `security-reviewer` when the categories include `security` or `pipeline`, or when the change handles input from outside the app, runs processes, or touches files outside the app data directory
   - `architecture-reviewer` for `architecture`, or when the change adds a project, crosses the shell/core/web boundaries, or changes a shared type
   - `data-reviewer` for `data`, or when the change reads or writes stored data
4. Fix every finding that affects correctness, security or the spec. Ignore style. Re-run verify and, if the fixes were substantial, the reviewers that raised them. Stop after two review rounds; anything still open goes in the PR under "Open findings".

## 5. Decide the risk

The final risk is the classifier's categories, plus every category a reviewer raised, plus any you judge applies after building it. You can add categories, never remove one. If any category remains, the PR is high risk.

## 6. Open the pull request

Write `.sdlc/pr-body.md` following `.github/pull_request_template.md`:

- **Owner review focus** (high risk only): collect the reviewers' focus items, merge duplicates and keep the list short (aim for five or fewer). Each item is a `path:start-end` link to the exact lines, why it is risky, and one concrete question the owner can answer by reading those lines. Point at the lines where the risky decision is made, not at whole files. For low risk, write "None — low risk".
- **Safe to skim**: every other changed file, one line each on what changed.
- Add `<!-- risk:raise <category> -->` for each category you or the reviewers raised that the path classifier missed.
- Add `<!-- ai-review: pass -->` only if no correctness or security finding is open.
- Paste the verify command with the tail of its output as evidence, and attach screenshots if the spec asked for them.

Set the spec's `status: built` in the same branch and commit it.

Push the branch and open the PR (or update its description if it exists):

```bash
git push -u origin HEAD
gh pr create --base main --title "<type>(<scope>): <spec title>" --body-file .sdlc/pr-body.md
```

## 7. Report

Tell the owner, in a few lines: the PR link, low or high risk, and what they need to do. That is nothing for low risk (it merges itself when CI is green), or the review-focus items and "add the `human-approved` label when you're satisfied" for high risk.
