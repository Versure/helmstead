# Review team: who runs the review loop

Companion to `proposal.md`, which sets the loop (rounds, cap, what gets fixed). This file defines
the agents: their roles, inputs, output format and the voting rules. When built, each role becomes
a file in `.claude/agents/` and the rules shared by all of them go in `.claude/REVIEW.md`.

## Roles

| Role | Agent | Runs | Tools |
|---|---|---|---|
| Orchestrator | the `/build` session itself | always | all; the only one that edits, commits or writes the PR |
| Finder: correctness | `bug-reviewer` (new) | every round | Read, Grep, Glob |
| Finder: spec | `spec-reviewer` | round 1, and later rounds if the fix diff touches a criterion's code or tests | Read, Grep, Glob |
| Finder: security | `security-reviewer` | when its area is touched, as today (see Area reviewers) | Read, Grep, Glob |
| Finder: architecture | `architecture-reviewer` | when its area is touched, as today (same) | Read, Grep, Glob |
| Finder: data | `data-reviewer` | when its area is touched, as today (same) | Read, Grep, Glob |
| Voter | `finding-verifier` (new), run three times per batch, once per check | every round with findings | Read, Grep, Glob |

**Area reviewers.** "As today" means `/build` step 4's triggers: the categories in
`.sdlc/risk.json` plus its judgment triggers (outside input, processes, files outside the app data
directory; a new project, a boundary crossing, a shared type; stored data), the judgment triggers
read against the round's diff. Every run writes `.sdlc/risk.json` for the whole branch before its
first round, as step 4 does today, and writes it again before step 5, so the final risk includes
the fix commits. No per-round classification: an area reviewer may run on a small fix diff, which
costs one agent but needs no extra bookkeeping.

Finders and voters are read-only and start with a fresh context. None of them sees the build's
reasoning, and no voter sees another voter's output.

## Finders

**Input:** the round number and whether this is a first run or a follow-up; the spec path; the
round's diff file (`.sdlc/review.diff`: the branch diff in round 1,
only the fix commits in later rounds; in a follow-up's round 1, that run's commits and the branch
diff of files it resolved in a rebase);
`.sdlc/risk.json`; `.claude/REVIEW.md`; the ledger so far (`.sdlc/ledger.md`, taken from the PR
description in a follow-up run, empty in a first run's round 1).

**Task:** find problems in the round's diff within the finder's focus (unchanged from today's
agent files; `bug-reviewer`: logic errors, wrong conditions, unhandled errors and empty states,
races, broken callers, docs or instructions the change makes untrue). Do not re-raise a finding the
ledger has decided unless you have new evidence, such as a fix that did not work. In rounds 2 and 3
report only what the fix diff caused or an instance a confirmed finding's fix left behind. Report
each class of
bug once, listing every instance.

**Output**, exactly:

```
VERDICT: pass | changes-needed
FINDINGS:
- severity: blocker|major|minor
  origin: introduced|pre-existing
  security: yes|no
  where: path:line (every instance of the class)
  claim: what is wrong
  evidence: the lines that show it, or the concrete input or sequence that triggers it
  class: short name of the bug class
OWNER REVIEW FOCUS:
- path:start-end — why this is risky — the question for the owner
RAISE: none | <category>
```

`spec-reviewer` and `bug-reviewer` leave OWNER REVIEW FOCUS empty and RAISE `none`, as
`spec-reviewer` does today.

## Voter (`finding-verifier`)

**Input:** one check name; the round number and whether this is a first run or a follow-up; a batch of at most eight findings, numbered `F1…`, without the finder's
name or verdict; the diff file; the spec; `.claude/REVIEW.md`; the ledger.

**Checks** (each run does one; the orchestrator assigns all three to every batch):

- **evidence**: open the cited lines. Does the code (or doc) actually say what the finding claims?
- **refute**: try to prove it wrong: find the guard, caller, test or rule that already handles it,
  or show the trigger cannot happen. Real only if refuting fails.
- **impact**: play out the trigger step by step. Does it end in wrong behaviour, and how bad?
  For a doc or instruction, follow it as the next agent would.

**Output**, one line per finding, exactly:

```
F<n> | real|not-real|unsure | blocker|major|minor|- | introduced|pre-existing | in-scope|out-of-scope | reason in one sentence
```

`not-real` when the claim is false, already handled, a repeat of a ledger entry without new
evidence, style, or (rounds 2 and 3) neither caused by the fix diff nor an instance a confirmed
finding's fix left behind.
`out-of-scope` only when the finding asks for more than the spec; a defect the change introduces
is always `in-scope`.
`unsure` when checking did not settle it.

## Voting rules (applied by the orchestrator, mechanically)

1. A voter that fails or answers in the wrong format is run once more. A finding that still lacks
   three valid votes is **open**: not fixed, not rejected, and it withholds the pass marker.
2. **Instances.** Before the vote, the orchestrator splits a finding that lists several
   instances into one finding per instance (`F2a`, `F2b`, …, same claim and class). Each is
   voted, decided and recorded in the ledger on its own, with the class in the Finding cell.
3. A finding is **confirmed** when at least two of its three votes are `real`. `unsure` does not
   count as real.
4. **Severity** is the median of the three votes, counting `not-real` and `unsure` as below minor.
   So a confirmed finding takes the highest severity two voters agree on. A confirmed security
   finding keeps its finder's severity. A **security finding** is one from `security-reviewer`
   or marked `security: yes`; the orchestrator sets `security: yes` on every `security-reviewer`
   finding before the vote. When Collect merges duplicates with different finder severities, the
   highest stands.
5. **Origin** and **scope** follow the majority of the votes; on a tie (missing votes) the finder's
   value stands.
6. **Security safety net:** a security finding rated blocker or major by its
   finder that gets exactly one `real` vote is not fixed, but goes to Owner review focus and adds
   `<!-- risk:raise security -->`.
7. The orchestrator records every finding in the ledger with its three votes and outcome, and does
   not change a verdict. It may decline to fix a confirmed finding only for the reasons the loop
   allows (pre-existing, out of scope, fix needs an owner decision, an introduced minor that is not a
   local edit or is found in round 3) and says which.
   Outcomes: fixed, rejected, nit, pre-existing, out of scope, open.

## Ledger (`.sdlc/ledger.md` during a run, copied into the PR description)

| ID | Round | Severity | Origin | Where | Finding | Votes | Outcome |
|---|---|---|---|---|---|---|---|
| R1-F3 | 1 | major | introduced | `libs/x/y.ts:40` | null result not handled | R R N | fixed `abc123` |

Votes are in check order (evidence, refute, impact): R real, N not-real, U unsure.

## Open nits for the spec

Confirmed minor findings from the last review round, left for `/spec` to settle (see
`review-log.md`):

- After instances are split, one instance of a class can be confirmed and another rejected; state
  that Act's "every instance of its class" means every *confirmed* instance, and that a rejected
  instance re-raised without new evidence is a repeat.
- State the order: split instances first, then Collect merges exact duplicates.
