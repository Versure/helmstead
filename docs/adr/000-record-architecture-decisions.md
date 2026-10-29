# 000 — Record architecture decisions

- Status: accepted
- Date: 2026-10-29

## Context

Helmstead is built mostly by AI agents under review by one owner. The design principles in `docs/plan.md` §2 are
only useful if a deviation is visible and deliberate, and if the reasons survive the conversation that produced them.

## Decision

Every decision that deviates from the principles in plan §2, or that changes the domain model, storage, a security
boundary, a public contract or a project boundary, is recorded as an ADR in `docs/adr/NNN-title.md` before it is
built. The file has these sections:

- **Status**: `proposed`, `accepted`, `superseded by NNN` or `rejected`, plus the date.
- **Context**: the forces at play and why a decision is needed.
- **Decision**: what we do, in the active voice.
- **Consequences**: what becomes easier and what becomes harder or riskier, including known gaps.

Numbers are never reused. `001` is reserved for Tauri versus Electron (plan §3.2); it is written when that spike is
done, so the numbers do not follow the date order.

An ADR is changed only by a pull request that the owner reviews (`docs/adr/**` is high risk in the risk gate).
A decision that is reversed gets a new ADR and the old one is marked superseded; the old text stays.

## Consequences

- Reviewing a deviation means reading one short file instead of reconstructing a discussion.
- Agents read `docs/adr/` before making design decisions (plan §10 rule 2).
- Writing an ADR adds a small cost to every deviation. That is the intent.
