# Helmstead

The build plan is `docs/plan.md`; §10 holds the working rules for agents. Decisions live in `docs/adr/`.

# How work flows here

- New work starts with `/spec` (an interview that ends in `docs/specs/NNN-slug.md`) and is built with `/build NNN`. The full flow and the risk policy are in `docs/sdlc.md`.
- Never merge a PR and never add the `human-approved` label; `scripts/sdlc/hooks/guard-shell.mjs` blocks it anyway.
- If a spec leaves open a choice about the domain model, storage, security or a public contract, stop and ask. Other gaps: pick the sensible option and list it under "Decisions I made" in the PR.

# Commands

- Verify a change (lint, test, build of affected projects): `node scripts/sdlc/verify.mjs`
- Risk of the current branch: `node scripts/sdlc/classify-risk.mjs`
- Install (Node 22+ and the .NET SDK pinned in `global.json`): `npm ci`
- One Angular test file: `npx nx test web --include=apps/web/src/app/app.spec.ts` (path from the repo root)
- One .NET test or test class: `dotnet test apps/core/Helmstead.Core.slnx --filter "FullyQualifiedName~HealthEndpointTests"`
- Regenerate the API contract after changing a core endpoint or DTO, then commit the result: `npx nx run api-contracts:generate`. `npx nx run api-contracts:check` fails when the committed contract is out of date.
- Run the core: `npx nx serve core` (listens on `http://127.0.0.1:5108` only)
- Project boundaries are in `docs/adr/002-module-boundaries.md`. Do not add `eslint-disable` for `@nx/enforce-module-boundaries`; lint rejects it. Changing the boundary rules, tags or architecture tests is high risk and waits for the owner.

# Conventions

- Branches: `feat/NNN-slug`, `fix/NNN-slug`, `chore/slug`. Commits: Conventional Commits, English, imperative.
- No live API calls in tests; use recorded fixtures (plan §9).
