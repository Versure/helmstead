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

## Proposal, round 2 (only the round-1 changes, with the round-1 log as ledger)

Finders: convergence, repo fit. 10 findings, 2 pairs of duplicates merged, leaving 8.

| ID | Finding | Votes | Verdict | Change |
|---|---|---|---|---|
| P2-G1 | "Caused by the fix diff" is checked by no step; an introduced finding voted out of scope matches two rules | R N R | minor | Voters reject later-round findings whose evidence is not in the fix diff; Act restates what out of scope means |
| P2-G2 | `review-team.md` still states the old rules (root REVIEW.md, no re-raise, missing vote = not real, median for security) | R R R | major | `review-team.md` brought in line; an accidentally dropped "rated blocker or major" restored |
| P2-G3 | Follow-up range misses rebase conflict edits and breaks on owner branch updates | R R R | major | Ledger records head and base; follow-up reviews what `git range-diff` shows as new or changed |
| P2-G4 | Ad-hoc variant has no round diff and no meaning for "commits a fix" | R R N | minor | Defined: round 1 = the task's change, later rounds = the fix edits |
| P2-G5 | A draft made at the cap is never marked ready again | R R R | minor | A later clean run runs `gh pr ready` |
| P2-G6 | An open (unvoted) finding has no exit on a low-risk PR | N N N | rejected | — (repeat of P1-F9) |
| P2-G7 | Ad-hoc variant has no outlet for open findings or the security net | R R R | minor | They are reported to the user |
| P2-G8 | Act vs Cap precedence in round 3 unstated | R N N | rejected | — |

Result: 2 confirmed major, 4 confirmed minor → revise, round 3.

## Proposal, round 3 (only the round-2 changes)

Finders: convergence, repo fit. 8 findings, 3 pairs of duplicates merged, leaving 5.

| ID | Finding | Votes | Verdict |
|---|---|---|---|
| P3-H1 | "Evidence must be in the fix diff" rejects a re-raised instance the fix missed | R R R | major |
| P3-H2 | `range-diff` ignores removed commits (a dropped fix) | R R R | minor |
| P3-H3 | Follow-up range fails when the recorded SHAs or the line are missing | R R R | major |
| P3-H4 | `range-diff` gives no diff and flags main-only context moves | R N N | rejected |
| P3-H5 | Open (unvoted) entries never re-voted; R R + failure becomes open | N N N | rejected |

Result: round 3 still confirms 2 majors. **Cap reached: stop patching, reconsider the approach.**

### Reconsidering the approach

Two classes came back in every round:

1. *Knowing what is new since the last review across rebases* (P1-F8 → P2-G3 → P3-H2, P3-H3).
   Each patch added git bookkeeping (a recorded commit, then a base, then `range-diff`), and each
   added failure mode was found next round. This is the same pattern as the earlier branch:
   hardening a mechanism instead of removing the need for it.
2. *Tying later rounds to the fix diff by location* (P1-F14 → P2-G1 → P3-H1). Each narrower rule
   rejected a real case.

New approach, smaller rather than larger:

- A follow-up run reviews only what it changes itself: its own commits, plus the branch diff of the
  files it resolved in a rebase. No `Reviewed up to` record, no `range-diff`. Commits pushed by
  others are listed for the owner, not agent-reviewed. (Removes P3-H2 and P3-H3 by removing the
  mechanism.)
- Later rounds count a finding by cause: caused by the fix diff, or an instance a confirmed
  finding's fix left behind. (Fixes P3-H1.)

This was checked once more as a fresh, final round on the reconsidered text only (below).

## Proposal, final check of the reconsidered approach (only the reconsideration diff)

Finders: convergence, repo fit. 9 findings, 2 pairs of duplicates merged, leaving 7.

| ID | Finding | Votes | Verdict |
|---|---|---|---|
| PF-K1 | Commits pushed by others can merge under a fresh pass marker on a low-risk PR | R R R | minor (nit) |
| PF-K2 | Without a record, "commits by others" cannot be identified | R N N | rejected (Claude trailers survive rebases) |
| PF-K3 | "For a later spec" has no ledger outcome; such findings end up "rejected" | R N R | minor (nit) |
| PF-K4 | A conflict-free rebase can break the branch unseen | N N N | rejected |
| PF-K5 | Rounds text could re-confirm a parked open finding and trip the cap | N N N | rejected |
| PF-K6 | Search for left-behind instances is unbounded | R N N | rejected |
| PF-K7 | A rebase later in the run is not covered | R N R | minor (nit) |

Result: **no confirmed blocker or major → proposal agreed.** The three confirmed minors are not
patched (last-round rule: no unreviewed fixes); they are listed in the proposal under "Open nits
for the spec".

## Review team, round 1 (full `review-team.md`; proposal treated as agreed)

Finders: voting soundness, implementability, proportion. 18 findings, merged to 14.

| ID | Finding | Votes | Verdict | Change |
|---|---|---|---|---|
| T1-T1 | Finders and voters aren't told the round or first-run/follow-up, yet apply round-dependent rules | R R R | major | Both inputs now include round number and run type |
| T1-T2 | Ledger drops class and instance list | R N N | rejected | — |
| T1-T3 | Security rules key on the `security:` flag, not on `security-reviewer` as source | R R R | major | Security finding defined as either; orchestrator sets the flag on all `security-reviewer` findings |
| T1-T4 | Ad-hoc variant has no orchestrator or inputs | R N N | rejected | — (covered by `.claude/REVIEW.md`) |
| T1-T5 | Rule 6 omits "non-local minor → nit" | R R R | minor | Added |
| T1-T6 | Not-real voters must guess origin/scope; dead tie clause | R N N | rejected | — |
| T1-T7 | `risk.json` not recomputed per round, so all area reviewers rerun | R R R | minor | Rounds 2–3 classify the fix diff into `.sdlc/round-risk.json` |
| T1-T8 | `bug-reviewer` and `spec-reviewer` overlap → double findings | R N N | rejected | — |
| T1-T9 | No cap on findings per finder | R N N | rejected | — |
| T1-T10 | Multi-instance finding with only some instances real | R R R | minor | Real if any instance is; instances two voters reject are not fixed |
| T1-T11 | `spec-reviewer` later-round trigger not mechanical | R N N | rejected | — |
| T1-T12 | Evidence check is near-automatic "real" | N N R | rejected | — |
| T1-T13 | Ledger shows earlier votes to voters | R N N | rejected | — |
| T1-T14 | Voters see finder's severity/origin → anchoring | R N N | rejected | — |

Result: 2 confirmed major, 3 confirmed minor → revise, round 2.

## Review team, round 2 (only the round-1 changes)

Finders: voting/rules, implementability. 7 findings, merged to 6.

| ID | Finding | Votes | Verdict | Change |
|---|---|---|---|---|
| T2-U1 | Dropping "as today" lost `/build`'s judgment triggers for area reviewers | R R R | major | "As today" restored and spelled out; applied to each round's diff |
| T2-U2 | Categories from fix commits never reach the final risk | R N R | minor | `round-risk.json` categories are added in step 5 |
| T2-U3 | A follow-up's round 1 picks area reviewers from the whole branch | R N R | minor | Every round except a first run's round 1 classifies its own diff |
| T2-U4 | Per-instance "not real" rule is not mechanical | R R R | minor | Rule replaced: instances are split into separate findings before the vote |
| T2-U5 | A vote-rejected instance isn't recorded and comes back | R R R | minor | Same change: each instance has its own ledger row |
| T2-U6 | Merged security duplicate has two finder severities | R N R | minor | Highest stands |

Note: U4 and U5 came from the round-1 fix for T1-T10. Instead of patching that rule, it was
replaced by a simpler one (split instances before the vote).

Result: 1 confirmed major → revise, round 3.

## Review team, round 3 (only the round-2 changes)

Finders: voting/rules, implementability. 7 findings, merged to 5.

| ID | Finding | Votes | Verdict |
|---|---|---|---|
| T3-W1 | After the split, a rejected instance vs "fix every instance of its class" | R N R | minor (nit) |
| T3-W2 | Order of split and Collect's merge not set | R R N | minor (nit) |
| T3-W3 | A follow-up has no branch classification; final risk understated | R R R | major |
| T3-W4 | One `--base` can't cover rebase-resolved files | R R R | minor |
| T3-W5 | `round-risk.json` is overwritten each round | R R R | minor |

Result: round 3 still confirms a major. **Cap reached: stop patching, reconsider the approach.**

### Reconsidering the approach

The class that kept coming back is per-round risk classification for picking area reviewers
(T1-T7 → T2-U1/U2/U3 → T3-W3/W4/W5). The round-1 fix for a *minor* cost finding (T1-T7) added a
second risk file, and every round after found a new hole in it. New approach: remove it. Area
reviewers are chosen as today, from the branch classification that every run writes fresh before
its first round and again before step 5, plus the judgment triggers read against the round's diff.
T1-T7's saving is given up on purpose: an area reviewer may run on a small diff (one extra agent).
This removes W3, W4 and W5 with the mechanism.

The instance class (T1-T10 → T2-U4/U5 → T3-W1/W2) produced only minors in round 3. By the
last-round rule they are not patched; they are listed as open nits in `review-team.md`.

The reconsidered text was checked once more as a final round (below).

## Review team, final check of the reconsidered approach

Finders: repo fit, consistency. Both reported the same 2 findings.

| ID | Finding | Votes | Verdict |
|---|---|---|---|
| TF-X1 | Whole-branch area-reviewer choice contradicts the agreed proposal ("reviewers whose area the fix diff touches") | R R R | major |
| TF-X2 | `risk.json` written only before round 1, so a fix that first enters a category (e.g. a dependency) gets no area reviewer | R R R | minor |

Result: **not agreed.** The reconsidered approach still has a confirmed major. It is not patched
further. Closing it means changing the already agreed proposal, which is the owner's call:

- Recommended: amend the proposal's Rounds line to "`bug-reviewer` plus the area reviewers chosen
  as in round 1, from the branch classification rewritten before each round". One sentence in each
  file; it also closes TF-X2, and adds no new file or state.
- Alternative: keep the proposal as is and bring back a per-round classification; that is the
  mechanism that failed three times above.
