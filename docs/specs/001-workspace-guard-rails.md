---
id: 001
title: Workspace skeleton and architecture guard rails
status: built            # draft | approved | built
type: feature            # feature | fix | chore | spike
plan-phase: 0            # docs/plan.md §8
branch: feat/001-workspace-guard-rails
---

# 001 — Workspace skeleton and architecture guard rails

## Problem
Helmstead is built mostly by AI agents, but the repo has no code and no machine-checked architecture yet. The rules in plan §2, §10 and §12 (Domain depends on nothing, no connector- or harness-specific code outside its adapter, frontend and core only meet through a contract) exist only as prose, so an agent can break them and nothing fails. Every later Phase 0 spec needs a workspace to build into.

## Outcome
A fresh clone installs with one command and `node scripts/sdlc/verify.mjs` lints, tests, format-checks and builds an empty-but-real Angular app, a .NET core with a health endpoint, and the shared libs on Windows, macOS and Linux. Breaking a project boundary, importing across apps, suppressing a boundary rule, letting the generated API contract drift from the core, or committing unformatted code makes CI fail. Changing any of those rules is itself high risk and waits for the owner.

## Acceptance criteria
Each one is testable and names how it is checked.

### Workspace
1. Given a fresh clone, when `npm ci` and then `node scripts/sdlc/verify.mjs` run, then lint, test, format check and build pass for every project — *check:* `ci` workflow green on `ubuntu-latest`, `windows-latest` and `macos-latest` (matrix in `.github/workflows/ci.yml`).
2. Given the workspace, then it contains `apps/web` (Angular, current version, standalone components, zoneless/signals defaults of the CLI), `apps/core` (.NET current LTS solution), `libs/api-contracts` and `libs/ui`, each an Nx project with `lint`, `test` and `build` targets (where `build` is meaningful) — *check:* `npx nx show projects` output in the PR, and criterion 1.
3. Given `apps/core`, then it holds `src/Helmstead.Core.Api`, `src/Helmstead.Core.Domain`, `src/Helmstead.Core.Persistence` and `tests/Helmstead.Core.Tests` (xUnit), matching plan §12 names; Persistence contains no EF Core yet — *check:* spec-reviewer against this spec.

### Workspace-level boundaries (Nx)
4. Given every Nx project, then it carries exactly one `scope:` tag (`scope:web` for `apps/web` and `libs/ui`, `scope:core` for `apps/core`, `scope:shared` for `libs/api-contracts`), and a project without exactly one `scope:` tag fails verification — *check:* a workspace test that reads the Nx project graph and asserts the tags, plus a unit test of that check against a fixture list with a missing and a duplicate tag. Spec 002 extends this check with `domain:` and `type:` tags.
5. Given `@nx/enforce-module-boundaries` configured in the root ESLint config, when a fixture file imports across forbidden edges (an app importing another app; `scope:web` importing a `scope:core` project; `scope:shared` importing anything but `scope:shared`), then ESLint reports the boundary error — *check:* a lint-rule test (e.g. `tools/eslint/boundaries.spec.ts`) that lints fixture files with ESLint's Node API and asserts one error per forbidden edge and none for the allowed edges (`scope:web` → `scope:shared`, `scope:web` → `scope:web` libs). The test harness is reusable so spec 002 can add its DDD cases.
6. Given a fixture file containing `// eslint-disable-next-line @nx/enforce-module-boundaries` (or a file-level disable of that rule), when lint runs, then it fails — *check:* same lint-rule test.

### Core boundaries (.NET)
7. Given the ArchUnitNET rules in `Helmstead.Core.Tests`, then all of these hold and are enforced:
   - `Helmstead.Core.Domain` references no other `Helmstead.*` assembly, no ASP.NET Core, no EF Core and no `System.Net.Http`;
   - `Helmstead.Core.Persistence` does not reference `Helmstead.Core.Api`;
   - only `Helmstead.Core.Api` references ASP.NET Core;
   - any `Helmstead.Connectors.*` assembly references no other `Helmstead.Connectors.*`, nor `Helmstead.Agents`, nor `Helmstead.Providers`;
   - `Helmstead.Agents` references no `Helmstead.Connectors.*`;
   - `Helmstead.Providers` references no `Helmstead.Connectors.*` and no `Helmstead.Agents`
   — *check:* the architecture tests pass on the real assemblies.
8. Given the same rule definitions, when applied to a deliberately violating fixture (a test-only fixture project per rule, or compiled fixture types, named `Helmstead.Connectors.FixtureA`/`FixtureB` etc.), then each rule fails — *check:* negative tests in `Helmstead.Core.Tests` that assert every rule reports a violation on its fixture. This proves the rules can fail.
9. Given a project added later under one of the name patterns above, then it is covered without editing the tests: assemblies are discovered by name pattern from the solution output, not from a hard-coded list — *check:* unit test of the discovery function against a list of assembly names.

### Contract between web and core
10. Given `GET /health` on the core, then it returns `200` with JSON `{ "status": "ok", "version": "<assembly informational version>" }` and nothing else — *check:* integration test with `WebApplicationFactory` in `Helmstead.Core.Tests`.
11. Given the core is started with its default configuration, then Kestrel listens only on a loopback address (`127.0.0.1`), and a configuration that binds to a non-loopback address makes startup fail with a clear error — *check:* unit test of the binding validation, plus integration test asserting the configured URLs.
12. Given the core builds, then its OpenAPI document is produced at build time and committed at `libs/api-contracts/openapi.json`, and TypeScript types generated from it live in `libs/api-contracts/src/generated/` and are exported from the lib's public entry point — *check:* CI.
13. Given a change to a core endpoint or DTO without regenerating, when CI runs, then the contract check (Nx target `api-contracts:check`: regenerate, then `git diff --exit-code` on `libs/api-contracts`) fails — *check:* the target runs inside `verify.mjs`; the PR shows it failing once on a temporary, reverted change.

### Formatting
14. Given an unformatted TypeScript, HTML, SCSS, JSON or Markdown file under `apps/` or `libs/`, or an unformatted C# file, when `verify.mjs` runs, then it fails — *check:* `verify.mjs` runs `nx format:check` and `dotnet format --verify-no-changes`; criterion 1 plus a one-off failing run shown in the PR.

### The rules guard themselves
15. Given a PR that changes the root ESLint config (`eslint.config.*`), any `project.json` tags, `.prettierrc*`, `.editorconfig`, the architecture test files or their fixtures, then the risk gate classifies it as high risk (architecture) — *check:* `scripts/sdlc/risk-paths.json` gains these paths; `node scripts/sdlc/classify-risk.mjs` output on this branch, in the PR, lists them under architecture.
16. Given `verify.mjs`, then it runs on all three OSes (no POSIX-only shell syntax) and its Stop-hook behaviour is unchanged for turns that touch only docs — *check:* criterion 1 and a manual run of `node scripts/sdlc/verify.mjs --hook` on a docs-only change, shown in the PR.

### Documentation
17. Given `docs/adr/`, then it holds `000-record-architecture-decisions.md` (the ADR format: context, decision, consequences, status) and `002-module-boundaries.md` (the `scope:` tags and allowed edges, the .NET layer rules, that .NET bounded-context rules are added by the specs that create those modules, that frontend DDD rules follow in spec 002, and the known gap that `/health` has no token until the sidecar spec). ADR number 001 stays reserved for Tauri vs Electron — *check:* spec-reviewer.
18. Given `CLAUDE.md`, then the Phase 0 placeholder under Commands is replaced with: the install command, how to run one Angular test file, how to run one .NET test (filter), and how to regenerate the API contract — *check:* spec-reviewer, and each command is run once in the PR.

## Out of scope
- `apps/shell` (Tauri or Electron). Decided first in an ADR-001 spike spec.
- Sidecar start-up, random port, session token and 401 on missing token (plan §3.3). `/health` is loopback-only without a token until then.
- SQLite, EF Core, migrations, `ISecretStore` and keychain.
- Structured logging, settings page, layout and navigation, and any UI that calls `/health`.
- `Helmstead.Agents`, `Helmstead.Connectors.*`, `Helmstead.Providers` and the other plan §12 projects; they are added by the spec that needs them (the rules already cover them by name).
- **Spec 002 (next): frontend architecture.** DDD layout in `libs/web/<domain>/<type>`, `domain:` and `type:` Nx tags, Sheriff inside projects, angular-eslint standards, design tokens and template accessibility. Already decided: features live in libs per domain with `apps/web` as a thin shell; Nx owns rules between projects and Sheriff owns rules inside a project (folders, no deep imports past the public barrel); a domain may import another domain only through that domain's `type:api` lib, plus `domain:shared`; HTTP only in `type:data-access`; core responses typed only with `@helmstead/api-contracts`, no `any`; modern Angular only (standalone, signals, OnPush/zoneless, new control flow, `inject()`); no hard-coded colours or spacing outside the Helm design tokens; angular-eslint accessibility rules. The rest is interviewed for 002.
- **Spec 003: supply-chain and test hygiene, already decided in this interview:** secret scanning with gitleaks in CI plus a PreToolUse hook on Claude's `git commit`; a dependency policy that fails CI on high-severity known vulnerabilities and on any license outside MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD and Unlicense (owner-maintained allowlist); and a ban on live network calls in tests.

## Decisions from the interview
- How to cut Phase 0 → this spec is workspace skeleton + guard rails; then ADR-001 spike, shell + sidecar + token, SQLite + keychain, logging + settings, each its own spec.
- Include `apps/shell`? → No; Tauri vs Electron is decided in a separate spike (ADR-001).
- How to enforce .NET boundaries → ArchUnitNET (test-only dependency) in xUnit.
- CI operating systems → Windows, macOS and Linux from this spec on.
- Which .NET projects → Core.Api, Core.Domain, Core.Persistence and one tests project; the rest arrive with their specs.
- Package manager → npm.
- Extra guard rails → secret scanning, format check, dependency policy, live-call ban; format check is here, the other three are spec 003.
- API contracts → wired now via OpenAPI, with a drift check in CI.
- Health endpoint before the token exists → loopback only, no token; the gap is recorded in ADR-002 and closed by the sidecar spec.
- Secret scanning location (for 003) → Claude PreToolUse hook + CI.
- License allowlist (for 003) → permissive only.
- Frontend architecture (owner asked why the frontend was missing) → Nx, DDD enforced with Sheriff, angular-eslint standards, HTTP only in data-access, contract types only, modern Angular only, design tokens + a11y; split into its own spec 002 so each PR stays reviewable. Details under Out of scope.
- DDD inside the .NET core → layer rules now; bounded-context rules arrive with the modules they govern.

## Risk forecast
High risk, by design: this spec sets the rules every later change is judged by.

- **Architecture & contracts** — `nx.json`, `tsconfig.base.json`, every `project.json`, the `.sln`/`.slnx`, `libs/api-contracts/**`, `apps/core/src/Helmstead.Core.Domain/**`, `docs/adr/**`. Owner focus: the `scope:` tags and `depConstraints` in the root ESLint config (do the allowed edges match ADR-002?), and the ArchUnitNET rule definitions (is every rule in criterion 7 present, and does the assembly discovery really pick up future projects?).
- **Dependencies & pipeline** — `package.json`, `package-lock.json`, `*.csproj`, `Directory.Build.*`/`Directory.Packages.props`, `global.json`, `.github/workflows/ci.yml`, `scripts/sdlc/verify.mjs`, `scripts/sdlc/risk-paths.json`, `CLAUDE.md`. Owner focus: the CI matrix and that no step is skipped on any OS; that `verify.mjs` cannot pass when a check did not run; that the new `risk-paths.json` entries only add rules and loosen nothing; the list of new top-level packages (ArchUnitNET, the OpenAPI tooling, openapi-typescript or equivalent).
- **Security** — `appsettings*.json` matches the security paths. Owner focus: the Kestrel binding and its non-loopback guard in `Helmstead.Core.Api`'s startup code.
- **Size** — likely over 1000 lines of scaffold outside lock files; the generated Angular and Nx boilerplate is "safe to skim".

## Notes for the build
- Plan §2 (principles), §3.2 (technology), §9 (testing), §12 (repository layout). No ADRs exist yet; this spec creates the first two.
- Verify current versions before scaffolding (plan §10 rule 3): Nx and its Angular preset, Angular CLI defaults (test runner, zoneless), .NET LTS (pin in `global.json`), Nx support for .NET (`@nx/dotnet` if stable, otherwise `project.json` with `nx:run-commands` targets), ArchUnitNET's xUnit package, and the ASP.NET Core build-time OpenAPI generation (`Microsoft.Extensions.ApiDescription.Server`).
- Use central package management for NuGet (`Directory.Packages.props`) so versions live in one place.
- The lint-rule fixtures (criteria 5–6) and the ArchUnitNET fixtures (criterion 8) must not be part of any real build output or tag scheme; exclude them from `nx affected` builds and from the real-assembly scan.
- `ci.yml` already runs `node scripts/sdlc/verify.mjs`; extend it with the OS matrix and `actions/setup-dotnet`. Keep `.gitattributes` line-ending rules working so the contract check doesn't fail on Windows checkouts.
- `verify.mjs` currently exits 0 when `nx.json` is missing; after this spec `nx.json` exists, so that branch becomes dead for this repo but can stay.
- Live API calls are already banned in tests by plan §9; none are needed here.

## Open questions

## Changes after owner review (PR #2)
- The .NET projects are folded into Nx with `@nx/dotnet` (was: `project.json` with run-commands). The fixtures are build-only Nx projects, because the test project references them and Nx must see that to cache correctly; they stay out of the real-assembly scan.
- Criterion 3 changed: the core is vertical slices with CQRS inside `Helmstead.Core.Api` (ADR 003). `Helmstead.Core.Domain` and `Helmstead.Core.Persistence` no longer exist; the Domain and Persistence rules of criterion 7 became the slice, CQRS and domain-code rules.
- Angular best practices are enforced by `tools/eslint/eslint.angular.config.mjs` for `apps/web` and `libs/ui` (angular-eslint recommended and accessibility presets, typescript-eslint strict, plus modern-Angular rules). Sheriff and the DDD layout stay in spec 002.
