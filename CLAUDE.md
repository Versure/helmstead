# Helmstead

The build plan is `docs/plan.md`; §10 holds the working rules for agents. Decisions live in `docs/adr/`.

# How work flows here

- New work starts with `/spec` (an interview that ends in `docs/specs/NNN-slug.md`) and is built with `/build NNN`. The full flow and the risk policy are in `docs/sdlc.md`.
- Never merge a PR and never add the `human-approved` label; `scripts/sdlc/hooks/guard-shell.mjs` blocks it anyway.
- If a spec leaves open a choice about the domain model, storage, security or a public contract, stop and ask. Other gaps: pick the sensible option and list it under "Decisions I made" in the PR.

# Commands

- Verify a change (lint, test, build of affected projects): `node scripts/sdlc/verify.mjs`
- Risk of the current branch: `node scripts/sdlc/classify-risk.mjs`
- Phase 0 has not created the Nx workspace yet. When it does, add the install command and how to run a single test file (Angular and .NET) here.

# Conventions

- Branches: `feat/NNN-slug`, `fix/NNN-slug`, `chore/slug`. Commits: Conventional Commits, English, imperative.
- No live API calls in tests; use recorded fixtures (plan §9).
