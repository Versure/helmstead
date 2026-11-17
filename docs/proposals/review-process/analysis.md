# Why the review-and-fix loop did not converge

Evidence: branch `claude/brave-lamport-81e2xk` (7 commits, 20 files, +586 lines), the post
"Solving code review at Anthropic", and `origin/main`'s `/build` step 4.

## What happened

The task was "add a voting step". After each commit one fresh agent reviewed the **whole branch**
and **every** finding was fixed. Six rounds later each review still found new major problems,
mostly in machinery the previous round had added: approval-label binding, concurrency, label
revocation, comment trust, a new GitHub MCP guard. The diff grew from a review change into a
rewrite of the risk gate's approval model.

## The process issue (applies to any agent review loop)

1. **Every finding was treated as true.** One reviewer, no check. A reviewer asked to find problems
   always finds some; unverified findings include wrong ones, inflated ones and taste. The post's
   answer: several reviewers find, a separate group votes, only agreed findings count.
2. **Every round reviewed everything.** Re-reading the whole branch finds old issues the first pass
   missed, so a later round never comes back clean. The post measured this: about 59% of repeated
   flags were on code present since the first pass. Answer: later rounds review only the fix diff.
3. **No memory of decisions.** Nothing recorded what was already found, fixed or rejected, so the
   same ground was raised again in new words. Answer: a ledger of decided findings, no repeats.
4. **Fixes grew the surface.** Each finding was fixed by adding a mechanism (a hook, a status, a
   marker parser), and each mechanism is new code for the next round to attack. Findings were
   fixed one instance at a time instead of by class. Answer: the smallest fix, the whole class,
   and a fix that needs a new mechanism is not a fix but a new decision.
5. **No scope test.** Findings about weaknesses that existed before the change (the approval
   label, comment trust) were treated as the change's fault and fixed in it. That is how "add
   voting" became "harden the gate". Answer: tag pre-existing and out-of-scope findings; log them,
   do not fix them in this change.
6. **No stop rule and no step back.** No round cap and no point where the approach was questioned.
   Answer: at most three rounds; a blocker or major still confirmed in round 3 means reconsider the
   approach, not patch again.
7. **Owner decisions were designed around.** Several findings came from one known limit (Claude
   opens PRs with the owner's account, so approval is a label). That is the owner's call, already
   documented in `docs/sdlc.md` §5; designing around it produced most of the churn.

## What `origin/main` already has, and lacks

`/build` step 4 already caps review at two rounds and parks leftovers under "Open findings". It
lacks: verification of findings, a shared severity scale and evidence rule, diff-only re-review,
a ledger, origin and scope tags, and a stop-and-reconsider rule. It also only governs `/build`;
the failed loop ran outside it, so the rules must also apply to ad-hoc agent reviews.

## What a converging process needs

- Findings need evidence and a shared severity scale.
- Independent votes decide which findings are real; only those are acted on.
- Fix only what the change introduced and its scope covers; log the rest.
- Later rounds review only what changed, with a record of decisions.
- A hard round cap that ends in "reconsider", not in more patches.
- Questions that are the owner's go to the owner.

None of this depends on Helmstead's gate, labels or hooks. The Helmstead-specific part is only
where these rules live (`/build`, the agent files, the PR description) and that the risk gate
needs no change to support them.
