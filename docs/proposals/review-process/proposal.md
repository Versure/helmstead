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
   every finding; a shared severity scale and a "what failure looks like here" file (`REVIEW.md`);
   style dropped; Important / Nit / Pre-existing tags; fix the class, not the instance; diff-only
   re-review; no repeats; a three-round cap that ends in reconsidering the approach; a general bug
   reviewer on every change. Not adopted here: see Out of scope.

## In scope

- The review step of `/build` (step 4), the PR description's AI review section, and the follow-up
  round (`/build NNN address the PR comments`).
- The reviewer agents' input and output, a new voter agent, a new general bug reviewer.
- `REVIEW.md`: severity scale, evidence rule, what to skip.
- One line in `CLAUDE.md` so ad-hoc agent reviews follow `REVIEW.md` too.

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

Severity, defined once in `REVIEW.md`:

- **blocker**: merging breaks main or the build, loses or exposes data, opens a reachable security
  hole, or fails an acceptance criterion.
- **major**: wrong behaviour in a realistic scenario, or a doc or instruction the change makes
  untrue (for an instruction file, failure is "it misdirects the next agent").
- **minor**: real but unlikely or cheap: an edge case, a small inconsistency.

Origin: **introduced** (the change causes it) or **pre-existing** (it was there on `main`).

### One round

1. **Find.** The reviewers run in parallel on the round's diff (see Rounds). `bug-reviewer` and
   `spec-reviewer` always; the security, architecture and data reviewers when their area is touched,
   as today.
2. **Collect.** The build numbers the findings, merges exact duplicates (same location, same claim)
   and drops any that repeat a ledger entry, recording each drop in the ledger. It does not judge
   whether a finding is right.
3. **Vote.** Three voter agents, one per check (evidence, refute, impact), each vote on every
   finding of the round. Each voter sees the findings, the diff, the spec, `REVIEW.md` and the
   ledger; never another voter's vote nor the build's opinion. A voter gets at most eight findings;
   more are split into batches, each batch with its own three voters.
4. **Decide**, mechanically:
   - **Confirmed** when at least two of three vote real. A missing or unreadable vote counts as
     unsure, and unsure is not real.
   - Severity: the median of the three votes, where not-real or unsure counts as below minor.
   - Origin and scope: what the majority says.
   - **Security safety net.** A security finding (from `security-reviewer`, or tagged security)
     that the reporter rated blocker or major and that got exactly one real vote is not fixed, but
     is listed under Owner review focus and the PR gets `<!-- risk:raise security -->`, so the owner
     sees it. This uses the gate as it is.
5. **Act** on confirmed findings only:
   - introduced, in scope, blocker or major: fix it, every instance of its class, with the smallest
     change. If the fix needs something the spec does not cover (a new script, hook, workflow, file
     format or stored state, or any choice about the domain model, storage, security or a public
     contract), do not build it: it becomes an **open finding** for the owner.
   - introduced minor: fix it if it is a local edit; otherwise list it as a Nit.
   - pre-existing, or outside the spec's scope: do not fix. List it under Pre-existing / Out of
     scope; a pre-existing blocker also goes under Open findings so the owner sees it.
   - rejected: record it with its votes. Nothing else.
6. **Verify and commit** the fixes (`verify.mjs`), then update the ledger.

### Rounds

- **Round 1** reviews the branch diff (`origin/main...HEAD`).
- **Rounds 2 and 3** run only if the previous round committed fixes. They review only those fix
  commits (`<last reviewed commit>..HEAD`), with `bug-reviewer` plus the reviewers whose area the fix
  diff touches. A finding on code the fix diff did not change is out of scope for that round.
- **Agreed** when a round confirms no blocker or major finding to fix.
- **Cap.** If round 3 still confirms an introduced blocker or major, stop patching. Open the PR as a
  **draft**, without the pass marker, with a "Reconsider the approach" section naming the bug
  classes that kept coming back, and tell the owner. A draft never auto-merges.

### The ledger

The PR description's AI review section holds one table, written by the build:

| ID | Round | Severity | Origin | Where | Finding | Votes | Outcome |

Outcome is one of: fixed (`sha`), rejected, nit, pre-existing, out of scope, open. Under it, one
line: `Reviewed up to: <sha>`. The gate never reads the ledger; only `/build` does.

### Pass marker

`<!-- ai-review: pass -->` is added only when no confirmed introduced blocker or major is open and
the loop did not stop at the cap. Pre-existing findings, nits and rejected findings do not block.

### Follow-up runs

`/build NNN address the PR comments` treats the owner's comments as requirements, as today. It
reads the ledger and reviews only the commits after `Reviewed up to`; if that commit is no longer an
ancestor (after a rebase) it reviews the whole branch, still with the ledger. Each run has its own
three-round cap: a run starts only when the owner asks, which is the human brake on the loop.

### Ad-hoc reviews

`CLAUDE.md` gets one line: when an agent reviews its own work outside `/build`, it follows the
find, vote, decide, round and cap rules in `REVIEW.md`. That is the loop that failed.

## Files changed when built

| File | Change |
|---|---|
| `REVIEW.md` (new) | Severity scale, evidence rule, what to skip, origin and scope, round and cap rules |
| `.claude/agents/finding-verifier.md` (new) | The voter, one check per run |
| `.claude/agents/bug-reviewer.md` (new) | General correctness reviewer, every change |
| `.claude/agents/{spec,security,architecture,data}-reviewer.md` | New finding format; read `REVIEW.md` and the ledger |
| `.claude/skills/build/SKILL.md` | Step 4 replaced by the loop above; step 1 follow-up reads the ledger; step 6 ledger and pass rule |
| `.github/pull_request_template.md` | AI review section: the ledger table and `Reviewed up to` |
| `docs/sdlc.md` | Section 2 and 4 describe the vote and the cap in a few lines |
| `CLAUDE.md` | One line pointing ad-hoc reviews at `REVIEW.md` |

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
