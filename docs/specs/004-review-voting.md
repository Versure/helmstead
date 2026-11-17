---
id: 004
title: Review loop that votes, stays in scope and stops
status: approved         # draft | approved | built
type: chore              # feature | fix | chore | spike
plan-phase: 0            # docs/plan.md §8
branch: chore/004-review-voting
---

# 004 — Review loop that votes, stays in scope and stops

## Problem
The agent review in `/build` acts on every finding a reviewer reports, with no check that it is
real, and nothing stops a review-and-fix loop from drifting or running on. An earlier attempt to
add voting (branch `claude/brave-lamport-81e2xk`) went six rounds without converging. The analysis
is in `docs/proposals/review-process/analysis.md`.

## Outcome
Every review finding is voted on by three independent agents and only agreed-real findings are
fixed. Later rounds review only the fixes. The loop ends in at most three rounds, either clean or
with the approach handed back to the owner. The same rules apply to reviews an agent runs outside
`/build`.

The design is agreed: `docs/proposals/review-process/proposal.md` (the loop) and `review-team.md`
(the agents), including owner decision TF-X1. This spec adds the owner's answers below; where they
differ from those files, this spec wins.

## Acceptance criteria

1. `.claude/REVIEW.md` exists and holds: the severity scale (blocker, major, minor), the evidence
   rule, what is not a finding (style), origin and scope definitions, the round and cap rules, the
   pass-marker rule and the ad-hoc variant — *check:* workspace test
   `tools/workspace/review-process.spec.ts` asserts a heading per item.
2. `.claude/agents/finding-verifier.md` exists with tools `Read, Grep, Glob` only, defines the
   checks `evidence`, `refute` and `impact`, its inputs (check name, round number and run type,
   batch of at most eight findings without finder name or verdict, diff, spec, `.claude/REVIEW.md`,
   ledger) and the exact one-line vote format from `review-team.md` — *check:* workspace test parses
   the frontmatter and the format line.
3. `.claude/agents/bug-reviewer.md` exists, read-only (`Read, Grep, Glob`), with the focus from
   `review-team.md` — *check:* workspace test.
4. All five finder agents (`bug`, `spec`, `security`, `architecture`, `data`) state the same finding
   format (`severity`, `origin`, `security`, `where`, `claim`, `evidence`, `class`), read
   `.claude/REVIEW.md` and the ledger, take the round number and run type, and keep the
   `OWNER REVIEW FOCUS` and `RAISE` blocks — *check:* workspace test over the five files.
5. `/build` step 4 (`.claude/skills/build/SKILL.md`) runs the loop of the proposal: find, collect,
   vote, decide, act, verify; voting rules 1–7 of `review-team.md`; round 1 on the branch diff,
   rounds 2–3 on the fix commits; `.sdlc/risk.json` rewritten for the whole branch before every
   round and before step 5 (TF-X1); the cap turns the PR into a draft with "Reconsider the
   approach" — *check:* workspace test asserts the skill names `finding-verifier`, `bug-reviewer`,
   `.claude/REVIEW.md` and the three checks; the dry run (criterion 10) shows the behaviour.
6. Follow-up runs review only their own commits plus files resolved in **any** rebase during the
   run, and take the ledger from the PR description — *check:* workspace test for the wording; dry
   run.
7. The pass marker `<!-- ai-review: pass -->` is withheld when a confirmed introduced blocker or
   major is open, a finding lacks three valid votes, the loop hit the cap, **or the branch has
   commits not made by the build** (commits in `origin/main..HEAD` without the build's
   `Claude-Session:` trailer). A run that cannot add it removes an earlier one before it pushes.
   The skill and the PR template's marker comment state the same rule — *check:* workspace test
   compares the two.
8. The PR template's AI review section holds the ledger table (`ID | Round | Severity | Origin |
   Where | Finding | Votes | Outcome`) and lists the outcomes `fixed, rejected, nit, pre-existing,
   out of scope, later, open` — *check:* workspace test.
9. `docs/sdlc.md` §2 and §4 describe the vote and the cap in a few lines, and `CLAUDE.md` has one
   line sending ad-hoc agent reviews to `.claude/REVIEW.md` — *check:* workspace test.
10. A dry run on a throwaway branch with one seeded real bug and one change that invites a false
    finding: the ledger shows three votes per finding, the real bug confirmed and fixed, the false
    one rejected, and the loop ending in at most three rounds. The throwaway branch is not pushed
    or merged — *check:* the ledger and a short log pasted in the PR as evidence.

## Out of scope
- Any change to `scripts/sdlc/**`, `.github/workflows/**`, hooks, labels, `risk-paths.json` or the
  risk gate.
- How owner approval works; a separate GitHub account for Claude (owner: not for now).
- Approval-label binding and comment trust (known limits; see the owner's question 4).
- From the post: incident-based evals, measuring reviewer noise, nightly reviews, merge queue,
  effort levels, "How to revert" in the PR template.
- The old branch `claude/brave-lamport-81e2xk`: not touched; the owner deletes it.

## Decisions from the interview
- X1: later rounds use `bug-reviewer` plus the area reviewers chosen as in round 1, from
  `.sdlc/risk.json` rewritten before each round → approved.
- Commits on the branch not made by the build → withhold the pass marker (owner reviews them).
- How to check → guard tests in `tools/workspace` plus one recorded dry run.
- Open nits → defaults accepted: ledger outcome `later` for findings parked for a later spec
  (instead of `rejected`); conflicts resolved in any rebase during the run are reviewed;
  instances are split before Collect merges duplicates, and "fix every instance of its class"
  means every confirmed instance.
- Claude's own GitHub account → not for now.
- Old branch → left alone; the owner deletes it.

## Risk forecast
High risk, pipeline (`.claude/**`, `CLAUDE.md`, `docs/sdlc.md`) and architecture (`tools/**`).
The owner will want to read:
- `/build` step 4 and the pass-marker rule in `.claude/skills/build/SKILL.md`: does the loop stop
  where the proposal says, and is the marker withheld in every case of criterion 7?
- `.claude/agents/finding-verifier.md`: what voters see and do not see (independence).
- `.claude/REVIEW.md`: the severity scale and scope rule every reviewer and voter follows.

## Notes for the build
- Design source: `docs/proposals/review-process/proposal.md` and `review-team.md` (on this
  branch); `review-log.md` explains why each rule is there. Do not copy from branch
  `claude/brave-lamport-81e2xk`.
- Existing reviewer files: `.claude/agents/*.md`; keep their focus text, change only input and
  output.
- Workspace tests live in `tools/workspace/` and run via `tools/vitest.config.mts` (part of
  `node scripts/sdlc/verify.mjs`); see `ci-workflow.spec.ts` for the style.
- The build reviews its own diff with the current (old) review step; the new loop applies from the
  next build on.

## Open questions
