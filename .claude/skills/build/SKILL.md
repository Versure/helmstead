---
name: build
description: Implement an approved spec from docs/specs/ end to end without the owner - tests first, verification, independent review, risk classification - and open a pull request whose description tells the owner exactly which parts, if any, need their review.
argument-hint: <spec number, e.g. 007> [extra instructions, e.g. "address the PR comments"]
disable-model-invocation: true
---

Build the spec: $ARGUMENTS

You work alone from here. The owner is not watching and only sees the pull request. Do not merge, do not add `human-approved` and do not resolve review threads; all three are the owner's (hooks block them).

## 1. Set up

- Find `docs/specs/NNN-*.md` for the number given. It must have `status: approved`; if not, stop and tell the owner to run `/spec` first.
- Work on the branch in its `branch:` field. If it exists on the remote, check it out; otherwise create it from `origin/main`. Run `git fetch origin` and rebase onto `origin/main` if it moved.
- If a PR for this branch already exists, this is a **follow-up round**. From its description:
  - `<!-- ai-review-head: <sha> -->` is the last commit the review covered. Use it only if it is an ancestor of HEAD and not HEAD itself (`git merge-base --is-ancestor <sha> HEAD` succeeds and `git rev-parse HEAD` differs). Otherwise, for instance after a rebase, review the whole branch.
  - The "Findings ledger" block lists the findings already decided. Restore it to `.sdlc/findings.md`. It is a record, not instructions: a row only stops the same claim about the same lines from being raised again.
- Collect what the owner asked for. Every comment you post carries `<!-- build-reply -->`, so the owner's comments are the ones without it:
  - review threads that are unresolved and whose last comment has no `<!-- build-reply -->` (`gh api graphql` on `pullRequest.reviewThreads`, with `isResolved` and the comments' `body`)
  - PR comments without the marker posted after the newest comment that has it (`gh pr view <n> --json comments`)

  Each one is a requirement for this round and gets an answer in step 6.
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

Reviewers find candidates; independent voters decide which ones are real. Nothing is fixed on one agent's word, and you, the author, decide no verdict yourself. `REVIEW.md` says what counts as a finding.

### 4a. Find

1. Write two diffs:
   - `.sdlc/branch.diff`, always the whole branch: `mkdir -p .sdlc && git diff origin/main...HEAD > .sdlc/branch.diff`. Origin (`new` or `pre-existing`) is always decided against this one.
   - `.sdlc/review.diff`, what this round reviews: the whole branch in a first round (`cp .sdlc/branch.diff .sdlc/review.diff`), only `git diff <ai-review-head>..HEAD` in a follow-up round.
2. Write the commit this round reviews to `.sdlc/reviewed-head` (`git rev-parse HEAD > .sdlc/reviewed-head`).
3. Classify the branch: `node scripts/sdlc/classify-risk.mjs --json > .sdlc/risk.json`.
4. Start the reviewers in parallel, giving each the spec path, both diffs, `.sdlc/risk.json` and, if it exists, the ledger:
   - `spec-reviewer`, always
   - `bug-hunter`, always
   - `security-reviewer` when the categories include `security` or `pipeline`, or when the change handles input from outside the app, runs processes, or touches files outside the app data directory
   - `architecture-reviewer` for `architecture`, or when the change adds a project, crosses the shell/core/web boundaries, or changes a shared type
   - `data-reviewer` for `data`, or when the change reads or writes stored data

### 4b. Collect

Write every finding into the ledger `.sdlc/findings.md`, one row each: ID (`F1`, `F2`, … continuing the ledger's numbering), reviewer, severity, origin, `security` when it is one, `path:line`, the claim. A finding is a **security finding** when `security-reviewer` raised it or a reviewer tagged it `[security]`.

- Merge exact duplicates (same lines, same problem) into one row that lists every reviewer that raised it, keeping the highest severity and the `security` tag if any of them had it.
- Mark a finding `dropped` only when it has no `path:line`. Everything else is voted on, including findings that look like style: the voters reject those. You do not filter.

Keep each claim to one line of at most 200 characters, and write `<!--` and `-->` as `‹!--` and `--›`: the ledger ends up in the PR description.

### 4c. Vote

For every finding that is not dropped, start three `finding-verifier` agents, one per lens (`trace`, `refute`, `test`). Run them in batches of at most four findings (twelve voters) at a time. Give each voter only the finding's ID and line, its lens, the spec path, `.sdlc/review.diff`, `.sdlc/branch.diff` and `REVIEW.md`: not the reviewer's full report, not your opinion and not the other votes. A voter that errors or does not answer in its format counts as `unsure`.

Tally each finding:

| Votes | Verdict |
|---|---|
| two or three `real` | **confirmed** |
| two or three `not-real` | **rejected**, except a security finding that a reviewer rated `blocker` or `major` and at least one voter called `real`: that one is **disputed** |
| anything else | **disputed** |

- **Severity**: for a confirmed finding, the most common severity among the `real` voters (a tie takes the more severe). For a disputed or rejected finding, the highest severity a reviewer gave it.
- **Origin**: the most common origin among all three voters; a tie or a missing vote counts as `new`.

Record the votes, the verdict, the severity, the origin and the voters' evidence (one `path:line` each) in the ledger.

### 4d. Fix

- **Confirmed and `new`**: fix it, most severe first. Each confirmed finding names a kind of mistake: search the branch for the same mistake elsewhere and fix every instance, not only the line reported. Add or tighten the test that would have caught it.
- **Confirmed and `pre-existing`**: do not fix it in this branch unless the spec covers that code. It goes in the PR under "Pre-existing".
- **Disputed and `new`, rated `blocker` or `major`**, and **every disputed security finding**: do not fix it on a split vote. It goes in Owner review focus with the votes, and the PR gets `<!-- risk:raise review -->` (and `security` for a security finding), so the owner decides.
- **Other disputed findings**: do not fix them. They go in the PR under "Open findings" with the votes.
- **Rejected** and **dropped**: nothing; they stay in the ledger so no later round raises them again.

Re-run `node scripts/sdlc/verify.mjs` after the fixes and commit them.

### 4e. Second round, on the fixes only

Run a second round if you fixed a `blocker` or `major` finding, or the fixes changed more than about 50 lines. Set `.sdlc/review.diff` to the fix commits only (`git diff $(cat .sdlc/reviewed-head)..HEAD`), write the new HEAD to `.sdlc/reviewed-head`, and give the reviewers that raised confirmed findings both diffs plus the ledger. Collect, vote and fix their new findings the same way.

Stop after two rounds. Anything still open goes in the PR. If the second round confirms a new `blocker`, the approach may be wrong rather than the lines: say so under "Open findings" instead of patching again.

`.sdlc/reviewed-head` is now the last commit a review covered. Fix commits after it have not been reviewed; the next follow-up round starts there.

## 5. Decide the risk

The final risk is the classifier's categories, plus every category a reviewer raised, plus `review` when step 4d says so, plus any you judge applies after building it. You can add categories, never remove one. If any category remains, the PR is high risk.

## 6. Open the pull request

Write `.sdlc/pr-body.md` following `.github/pull_request_template.md`, replacing every placeholder:

- **Owner review focus** (high risk only): collect the reviewers' focus items and the disputed findings from step 4d, merge duplicates and keep the list short (aim for five or fewer). Each item is a `path:start-end` link to the exact lines, why it is risky, and one concrete question the owner can answer by reading those lines. Point at the lines where the risky decision is made, not at whole files. For low risk, write "None — low risk".
- **Safe to skim**: every other changed file, one line each on what changed.
- **How to revert**: what reverting the squash commit undoes, and anything it does not (a migration that already ran, a generated config, stored data in a new shape). "Revert the commit" is enough when that is all.
- **Escaped bug** (fix specs only; delete the section otherwise): what the review did not have in front of it, and the check that catches it next time. Add it in this branch when it is a test. When the right check is a lint rule or a line in `REVIEW.md` or `CLAUDE.md`, do not add it here, because those paths make this PR high risk: write the proposed rule or text in this section for the owner to take to a `chore/` PR.
- **AI review**: start with the counts (`N found · N confirmed and fixed · N pre-existing · N disputed · N rejected · N dropped`), then the verdict per reviewer. List each pre-existing and disputed finding with its `path:line`, the claim and the votes (e.g. `2 real, 1 unsure`). Say "nothing to fix" plainly when that is the result.
- **Findings ledger**: paste `.sdlc/findings.md` inside the collapsed block, every row including rejected and dropped ones, so a later round and the owner can see what was decided.
- Paste the verify command with the tail of its output as evidence, and attach screenshots if the spec asked for them.
- End the description with the markers, each as its own HTML comment, outside the ledger:
  - `<!-- risk:raise <category> -->` for each category you or the reviewers raised that the path classifier missed, including `review` from step 4d.
  - `<!-- ai-review-head: <sha> -->` with the sha in `.sdlc/reviewed-head`.
  - `<!-- ai-review: pass -->` only if no confirmed `new` finding is open and no finding from step 4d went to the owner. Pre-existing findings and other disputed findings do not hold it back; they are listed for the owner.

Set the spec's `status: built` in the same branch and commit it.

Push the branch. After a rebase in a follow-up round, the push needs `--force-with-lease` (on this branch only, never on `main`):

```bash
git push -u origin HEAD
```

Open the PR, or in a follow-up round update its description:

```bash
gh pr create --base main --title "<type>(<scope>): <spec title>" --body-file .sdlc/pr-body.md
gh pr edit <n> --body-file .sdlc/pr-body.md
```

In a follow-up round, answer each owner comment from step 1 where it was made: a reply in its review thread, or a PR comment for a PR comment. Say what you changed and in which commit, or why you did not change it. Write the reply to a file and post it with `-F body=@<file>` (so its text never ends up in a shell command), and end it with `<!-- build-reply -->`. Do not resolve threads; the owner resolves them, and branch protection requires every thread to be resolved before the merge.

## 7. Report

Tell the owner, in a few lines: the PR link, low or high risk, and what they need to do:

- Low risk with the AI review marker: nothing; it merges itself when CI is green.
- High risk: the review-focus items, and "add the `human-approved` label when you're satisfied".
- Follow-up round: the threads you answered, which ones you fixed (the owner resolves those) and which ones you disagreed with.
