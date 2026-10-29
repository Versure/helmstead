---
id: NNN
title: Short name of the change
status: draft            # draft | approved | built
type: feature            # feature | fix | chore | spike
plan-phase: 0            # docs/plan.md §8
branch: feat/NNN-slug
---

# NNN — Short name of the change

## Problem
Who runs into what today, in two or three sentences.

## Outcome
What is true when this is done, from the user's side.

## Acceptance criteria
Each one is testable and names how it is checked.

1. Given …, when …, then … — *check:* unit test in `…` / component test / screenshot vs mockup
2. …

## Out of scope
- …

## Decisions from the interview
- Question → answer (and why, if the owner gave a reason)

## Risk forecast
Areas this will touch (security, architecture, data, pipeline) and why; `none` if it stays low risk.
For each high-risk area: the specific part the owner will want to look at.

## Notes for the build
Pointers the build can't easily find itself: mockup links, relevant ADRs, fixtures to use.

## Open questions
Must be empty before the status becomes `approved`.
