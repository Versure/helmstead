## Summary
<!-- What changed and why, in two or three sentences. -->

**Spec:** `docs/specs/NNN-slug.md`
**Risk:** LOW | HIGH — <categories>

## 🔍 Owner review focus
<!-- High risk only: the exact lines the owner must read. Low risk: "None — low risk". -->

| # | Where | Why it is risky | Question for you |
|---|---|---|---|
| 1 | `path/to/file.cs:40-62` | … | … |

## Safe to skim
<!-- Every other changed file, one line each. -->
- `path` — what changed

## Decisions I made
<!-- Gaps in the spec the build filled without asking, and why. -->
- …

## Verification
<!-- Command and the tail of its output; screenshots if the spec asked for them. -->
```
$ node scripts/sdlc/verify.mjs
…
```

## How to revert
<!-- What reverting the squash commit undoes, and what it does not (a migration that ran, generated config, data in a new shape). -->
<!-- e.g. Revert the commit; nothing else to undo. -->

## Escaped bug
<!-- Fix specs only; delete otherwise. What the review did not have in front of it, and the check that catches it next time: a test added here, or a lint rule or REVIEW.md/CLAUDE.md text proposed for a separate chore/ PR. -->

## AI review
<!-- Counts first, then the verdict per reviewer. Findings are voted on by three verifiers each; list pre-existing and disputed ones with their votes. -->
<!-- N found · N confirmed and fixed · N pre-existing · N disputed · N rejected · N dropped -->

- spec-reviewer: <!-- pass | changes-needed -->
- bug-hunter: <!-- pass | changes-needed -->
- Pre-existing: <!-- path:line — claim — votes, or none -->
- Open findings: <!-- path:line — claim — votes, or none -->

<details><summary>Findings ledger</summary>

| ID | Reviewer | Severity | Origin | Security | Where | Claim | Votes | Verdict | Evidence |
|---|---|---|---|---|---|---|---|---|---|

</details>

<!--
Markers added by /build below this comment as the last lines of the description, one HTML comment per
line and nothing after them. The risk gate reads markers only there.
  <!- - risk:raise <category> - ->    one per category the path rules missed
                                     (security, architecture, data, pipeline, review)
  <!- - ai-review-head: <sha> - ->    for the next /build round: the last commit the AI review covered
  <!- - ai-review: pass <sha> - ->    only when every commit up to <sha> was reviewed and nothing went to
                                     the owner; otherwise /build raises review instead
-->
