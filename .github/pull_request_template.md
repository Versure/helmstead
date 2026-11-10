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
<!-- Counts first, then the verdict per reviewer. Findings are voted on by three verifiers each; list pre-existing and disputed ones with their votes. -->
0 found · 0 confirmed and fixed · 0 pre-existing · 0 disputed · 0 rejected

- spec-reviewer: pass
- bug-hunter: pass
- Pre-existing: none
- Open findings: none

<!--
Markers for the risk gate, added by /build as separate HTML comments at the end:
  risk:raise <category>   one per category the path rules missed (security, architecture, data, pipeline)
  ai-review: pass         only when no confirmed new finding is open and no security finding is disputed
-->
