# Review log

How the proposal and the team definition were reviewed: three finder agents with different focuses,
then three voter agents per batch of findings (checks: evidence, refute, impact), blind to each
other. Confirmed = at least two "real" votes; severity = median vote. Only confirmed findings were
acted on. Votes are listed as evidence / refute / impact: R real, N not-real, U unsure.

## Proposal, round 1 (full document)

Finders: convergence, repo fit, requirements and scope. 18 findings, of which 3 were exact
duplicates and were merged, leaving 15.

| ID | Finding | Votes | Verdict | Change |
|---|---|---|---|---|
| P1-F1 | Failed voters reject every finding silently, then pass | R R R | major | A failed voter is re-run once; still missing → open, no pass |
| P1-F2 | Median can turn a confirmed security finding into a nit | R R R | major | A confirmed security finding keeps its finder's severity |
| P1-F3 | Build drops "repeats" before any vote; hides failed fixes | R R R | major | No pre-vote drop; voters judge repeats; new evidence may re-raise |
| P1-F4 | An introduced bug can be voted out of scope and pass | R R R | major | Defined: out of scope = asks for more than the spec; an introduced defect never is |
| P1-F5 | `review-team.md` missing; focus/RAISE outputs unclear | N N N | rejected | — (the file exists and keeps both outputs) |
| P1-F6 | Owner questions re-open the gate drift | N N N | rejected | — |
| P1-F7 | Root `REVIEW.md` is low risk, so the rules can loosen themselves | R R R | major | Moved to `.claude/REVIEW.md` (already a pipeline path) |
| P1-F8 | After a rebase, follow-ups fall back to whole-branch review | R R R | major | Follow-up reviews unreviewed commits plus its own, never the whole branch |
| P1-F9 | Low-risk PR without marker has no documented owner path | R N N | rejected | — |
| P1-F10 | Cap in a follow-up leaves a ready PR with the old pass marker | R N R | minor | Turn PR back to draft; remove marker before pushing |
| P1-F11 | Template marker comment contradicts the new pass rule | R R R | minor | Files table: template comment and SKILL step 6 state the new rule |
| P1-F12 | Ledger in gitignored `.sdlc/` is lost in a fresh worktree | N N R | rejected | — |
| P1-F13 | Stop rules disagree; last-round fixes unreviewed | R R R | minor | Loop ends when a round commits no fix; round 3 fixes no minors |
| P1-F14 | Later rounds drop bugs a fix causes in unchanged code | R R R | major | Later rounds take findings caused by the fix diff, wherever they land |
| P1-F15 | Ad-hoc reviews lack spec, ledger home and draft PR | R R R | major | `.claude/REVIEW.md` defines the ad-hoc substitutes |

Result: 8 confirmed major, 3 confirmed minor → revise, round 2.
