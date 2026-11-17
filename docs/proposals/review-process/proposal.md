# Proposal: a review loop that votes, stays in scope and stops

Status: draft. If the owner agrees, it becomes a spec via `/spec` and is built with `/build`.
Why this is needed: `analysis.md`. Who runs it: `review-team.md`.

## Goal

The agent review in `/build` (and any review an agent runs on its own work) acts only on findings
that independent voters agree are real, stays within the change's scope, and ends in at most three
rounds, either clean or with the approach handed back to the owner.

## Owner's requests, and how they are met

1. *Vote on every finding; fix only the ones agreed real.* Every finding goes to three independent
   voters with different checks; two "real" votes confirm it. Only confirmed findings are fixed.
2. *Improve review based on the post.* Adopted: separate find and vote steps; evidence required for
   every finding; a shared severity scale and a "what failure looks like here" file
   (`.claude/REVIEW.md`); style dropped; Important / Nit / Pre-existing tags; fix the class, not the
   instance; diff-only re-review; no repeats; a three-round cap that ends in reconsidering the
   approach; a general bug reviewer on every change. Not adopted here: see Out of scope.

## In scope

- The review step of `/build` (step 4), the PR description's AI review section, and the follow-up
  round (`/build NNN address the PR comments`).
- The reviewer agents' input and output, a new voter agent, a new general bug reviewer.
- `.claude/REVIEW.md`: severity scale, evidence rule, what to skip, the loop rules.
- One line in `CLAUDE.md` so ad-hoc agent reviews follow `.claude/REVIEW.md` too.

## Out of scope (logged, not changed)

- The risk gate, its markers, labels, hooks, workflows and branch protection. The gate keeps
  reading only `ai-review: pass` and `risk:raise`, exactly as today.
- How owner approval works (the `human-approved` label) and who may comment. These are known limits;
  see Questions for the owner.
- From the post, for later specs if wanted: incident-based evals of the reviewer, measuring
  reviewer noise, nightly reviews of existing code, merge queue, effort levels per repository,
  "How to revert" in the PR template.

## Design

### Finding

Every reviewer reports findings in one format (exact fields in `review-team.md`): severity, origin,
location, the claim, **evidence** (the file and line, or a concrete scenario that triggers it) and
the bug class. No evidence, no finding. Style, naming, formatting and "could be cleaner" are not
findings.

Severity, defined once in `.claude/REVIEW.md` (under `.claude/`, so a change to the rules is
always high risk and seen by the owner):

- **blocker**: merging breaks main or the build, loses or exposes data, opens a reachable security
  hole, or fails an acceptance criterion.
- **major**: wrong behaviour in a realistic scenario, or a doc or instruction the change makes
  untrue (for an instruction file, failure is "it misdirects the next agent").
- **minor**: real but unlikely or cheap: an edge case, a small inconsistency.

Origin: **introduced** (the change causes it, wherever the affected line is) or **pre-existing**
(it was there on `main`). Scope: a finding is **out of scope** only when it asks for something the
spec does not require (new behaviour, extra hardening). A defect the change introduces is never
out of scope.

### One round

1. **Find.** The reviewers run in parallel on the round's diff (see Rounds). `bug-reviewer` and
   `spec-reviewer` always; the security, architecture and data reviewers when their area is touched,
   as today. Reviewers get the ledger and do not re-raise a decided finding unless they have new
   evidence (for example, that a fix did not work).
2. **Collect.** The build numbers the findings and merges exact duplicates (same location, same
   claim). It drops nothing else and does not judge whether a finding is right.
3. **Vote.** Three voter agents, one per check (evidence, refute, impact), each vote on every
   finding of the round. Each voter sees the findings, the diff, the spec, `.claude/REVIEW.md` and
   the ledger; never another voter's vote nor the build's opinion. A finding that repeats a ledger
   entry with no new evidence is voted not-real; so is, in rounds 2 and 3, a finding that neither
   the fix diff caused nor shows a confirmed finding's fix to be incomplete. A voter gets at most eight findings;
   more are split into batches, each batch with its own three voters.
4. **Decide**, mechanically:
   - A voter that fails or answers in the wrong format is run once more. If a finding still lacks
     three valid votes, it is **open** (owner decides), not rejected.
   - **Confirmed** when at least two of three vote real. Unsure is not real.
   - Severity: the median of the three votes, where not-real or unsure counts as below minor.
   - Origin and scope: what the majority says.
   - **Security findings** (from `security-reviewer`, or tagged security): a confirmed one keeps the
     severity its finder gave. One its finder rated blocker or major that got exactly one real
     vote is not fixed, but is listed under
     Owner review focus and the PR gets `<!-- risk:raise security -->`, so the owner sees it. This
     uses the gate as it is.
5. **Act** on confirmed findings only:
   - introduced blocker or major: fix it, every instance of its class, with the smallest change. If
     the fix needs something the spec does not cover (a new script, hook, workflow, file format or
     stored state, or any choice about the domain model, storage, security or a public contract),
     do not build it: it becomes an **open finding** for the owner.
   - introduced minor: fix it if it is a local edit and this is not round 3; otherwise list it as a
     Nit.
   - pre-existing, or out of scope (asks for more than the spec; an introduced defect is never
     this): do not fix. List it under Pre-existing / Out of scope; a
     pre-existing blocker also goes under Open findings so the owner sees it.
   - rejected: record it with its votes. Nothing else.
6. **Verify and commit** the fixes (`verify.mjs`), then update the ledger.

### Rounds

- **Round 1** reviews the branch diff (`origin/main...HEAD`).
- **Rounds 2 and 3** run whenever the previous round committed a fix, and review only those fix
  commits (`<last reviewed commit>..HEAD`), with `bug-reviewer` plus the reviewers whose area the fix
  diff touches. A finding counts in these rounds for one of two causes, wherever the affected line
  is: the fix diff caused it, or the fix is incomplete (an instance of a confirmed finding's class
  is still there). Anything else is for a later spec, not this loop.
- The loop ends when a round commits no fix. Round 3 fixes no minors, so every fix is reviewed.
- **Cap.** If round 3 still confirms an introduced blocker or major, stop patching: no pass marker,
  the PR is (or is turned back into) a **draft** with `gh pr ready --undo`, and it gets a
  "Reconsider the approach" section naming the bug classes that kept coming back. Tell the owner.
  A draft never auto-merges. A later run that ends clean on such a draft marks it ready again
  (`gh pr ready`).

### The ledger

The PR description's AI review section holds one table, written by the build:

| ID | Round | Severity | Origin | Where | Finding | Votes | Outcome |

Outcome is one of: fixed (`sha`), rejected, nit, pre-existing, out of scope, open. The gate never
reads the ledger; only `/build` does.

### Pass marker

`<!-- ai-review: pass -->` is added only when no confirmed introduced blocker or major and no
unvoted finding is open, and the loop did not stop at the cap. Pre-existing findings, nits and
rejected findings do not block. A run that cannot add the marker removes any earlier one from the
description **before** it pushes.

### Follow-up runs

`/build NNN address the PR comments` treats the owner's comments as requirements, as today, and
takes the ledger from the PR description. Its round 1 reviews only what this run changes: the
commits it adds (from the head after step 1), plus, when step 1's rebase had conflicts, the branch
diff of each file it resolved. It never re-reviews the whole branch and needs no record of earlier
commits. Commits someone else pushed are not reviewed by agents; the run lists them in the PR for
the owner. Each run has its own three-round cap: a run starts only when the owner asks, which is
the human brake on the loop.

### Ad-hoc reviews

`CLAUDE.md` gets one line: when an agent reviews its own work outside `/build`, it follows
`.claude/REVIEW.md`. That file says what replaces the `/build` parts there: the task as the user
stated it is the scope, written at the top of the ledger before round 1; the ledger is a file in
the session; round 1 reviews the change made for the task, and each later round reviews the edits
made as fixes in the round before ("commits a fix" means "makes a fix"); open findings and
security findings with one real vote are reported to the user; at the cap the agent stops and
reports to the user with "Reconsider the approach" instead of opening a draft. That is the loop
that failed.

## Files changed when built

| File | Change |
|---|---|
| `.claude/REVIEW.md` (new) | Severity scale, evidence rule, what to skip, origin and scope, round and cap rules, ad-hoc variant |
| `.claude/agents/finding-verifier.md` (new) | The voter, one check per run |
| `.claude/agents/bug-reviewer.md` (new) | General correctness reviewer, every change |
| `.claude/agents/{spec,security,architecture,data}-reviewer.md` | New finding format; read `.claude/REVIEW.md` and the ledger |
| `.claude/skills/build/SKILL.md` | Step 4 replaced by the loop above; step 1 follow-up range and ledger; step 6 ledger, the new pass rule and marker removal before push |
| `.github/pull_request_template.md` | AI review section: the ledger table; the marker comment states the new pass rule |
| `docs/sdlc.md` | Section 2 and 4 describe the vote and the cap in a few lines |
| `CLAUDE.md` | One line pointing ad-hoc reviews at `.claude/REVIEW.md` |

No script, hook, workflow, label or gate change. The change is high risk (pipeline paths), so the
owner reviews it.

## Cost

A round with four reviewers and up to eight findings uses seven agents; rounds 2 and 3 are smaller.
A clean change pays one round: its reviewers plus three voters.

## Questions for the owner

1. **Claude's own GitHub account.** Approval is a label because Claude uses your account. A separate
   account would make approvals real GitHub reviews bound to a commit, and would end the class of
   findings about label trust. Do you want that? (Not needed for this proposal.)
2. **Pre-existing gate findings** from the earlier branch (label binding, comment trust): do you
   want them as their own spec, or left as known limits?
