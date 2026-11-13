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
- Licence check, offline (also part of verify): `node tools/supply-chain/cli.mjs licenses`. Vulnerabilities, online: `node tools/supply-chain/cli.mjs vulnerabilities`. Policy file only: `node tools/supply-chain/cli.mjs policy`. Rules and reasons: `docs/adr/005-supply-chain-policy.md`.
- A dependency that fails: fix it first. If it cannot be fixed, add an entry to `dependency-policy.json`, under `licenseExceptions` (`ecosystem`, `package`, `versionRange`, `reason`) or `vulnerabilityExceptions` (`ecosystem`, `package`, `advisory`, `reason`, `expires` as `YYYY-MM-DD`). The failure message prints the entry to fill in. Every exception is high risk and waits for the owner; never add one to get a build green without saying so in the PR.
- A gitleaks false positive: add its fingerprint (printed by the hook or CI) to `.gitleaksignore` with a comment line saying why. High risk, waits for the owner. Never commit a real or realistic token, not even in a test: build test tokens at runtime from pieces.
- Tests never reach the network (plan §9; `tools/testing/no-network.ts`, `apps/core/tests/Shared/NoNetwork.cs`). A test that truly needs a live API is named `*.live.spec.ts` (Vitest) or has `[Trait("Category", "Live")]` (xUnit), and runs only by hand: `HELMSTEAD_LIVE_TESTS=1 npx vitest run --config tools/vitest.config.mts <file>`, `HELMSTEAD_LIVE_TESTS=1 npx nx test <project> -c live`, or `HELMSTEAD_LIVE_TESTS=1 dotnet test apps/core/Helmstead.Core.slnx --filter "Category=Live"`. Never set that variable in a workflow.
- Core code is vertical slices with CQRS: a feature lives in `apps/core/src/Helmstead.Core.Api/Features/<Slice>/` (`Commands/`, `Queries/`, `Domain/`), shared code in `Shared/`. Rules and reasons are in `docs/adr/003-vertical-slices-and-cqrs.md`; architecture tests fail a slice that reaches into another.
- Angular code must follow the rules in `tools/eslint/eslint.angular.config.mjs` (signals, `inject()`, OnPush, new control flow, accessibility, no `any`).
- Project boundaries are in `docs/adr/002-module-boundaries.md`. Do not add `eslint-disable` for `@nx/enforce-module-boundaries` or `@angular-eslint/*`; lint rejects it. Changing the boundary rules, tags or architecture tests is high risk and waits for the owner.

# Frontend

- Rules and reasons: `docs/adr/004-frontend-architecture.md`. Lint, Stylelint and the guard-rail tests enforce them.
- A feature goes in a lib under `libs/web/<domain>/<type>` (`feature`, `ui`, `data-access`, `model`, `util`, `api`); `apps/web` holds only bootstrap, config, root routes and the root component. Another domain is reached only through its `api` lib.
- HTTP only in `data-access`, typed with `@helmstead/api-contracts`. Styles in `.css` files, only with `var(--helm-*)` tokens.
- Files say what they hold: `<name>.component.ts` (class `…Component`, with `.component.html`/`.css`/`.spec.ts`), `<name>.directive.ts`, `<name>.pipe.ts`, `<name>.service.ts`. Each component, directive and pipe has its own folder: `lib/<name>/<name>.component.ts`. `npx nx g @nx/angular:component libs/web/<domain>/<type>/src/lib/<name>/<name>` produces exactly that.
- Create a lib with:
  `npx nx g @nx/angular:library --directory=libs/web/<domain>/<type> --name=<domain>-<type> --importPath=@helmstead/<domain>-<type> --tags=scope:web,domain:<domain>,type:<type>`
  then make its `eslint.config.mjs` the one-line `export default webProject(import.meta.dirname)` the other libs use, add `"noUncheckedIndexedAccess": true` to its `tsconfig.json`, add it to the project list in `tools/workspace/scope-tags.spec.ts`, and run `npx nx lint <name> --fix` for its `package.json`. A new domain also goes in `tools/workspace/frontend-tags.mjs`.

# Conventions

- Branches: `feat/NNN-slug`, `fix/NNN-slug`, `chore/slug`. Commits: Conventional Commits, English, imperative.
- No live API calls in tests; use recorded fixtures (plan §9).
