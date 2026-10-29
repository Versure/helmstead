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

## AI review
<!-- Verdict per reviewer, and any finding left open. -->
- spec-reviewer: pass
- Open findings: none

<!--
Markers for the risk gate, added by /build as separate HTML comments at the end:
  risk:raise <category>   one per category the path rules missed (security, architecture, data, pipeline)
  ai-review: pass         only when no correctness or security finding is open
-->
