---
id: 002
title: Frontend architecture and Angular guard rails
status: approved         # draft | approved | built
type: feature            # feature | fix | chore | spike
plan-phase: 0            # docs/plan.md §8
branch: feat/002-frontend-architecture
---

# 002 — Frontend architecture and Angular guard rails

## Problem
After spec 001 the Angular side has a workspace and coarse `scope:` rules, but nothing tells an agent where frontend code belongs or how it must be written. Without enforced domains, layers and Angular standards, AI-written features drift into one tangled app: components calling HTTP directly, hand-written copies of API types, legacy Angular patterns and hard-coded styles that ignore the Helm design system.

## Outcome
Frontend code is organised by domain (DDD) in Nx libs, and lint fails whenever code crosses a domain or layer it may not, reaches past a lib's public entry point, calls HTTP outside a data-access lib, types a core response with anything but the generated contract, uses legacy Angular patterns, hard-codes a colour, spacing or font size, or breaks template accessibility. One real domain, `system`, shows the pattern end to end: a status badge in the app that reports whether the core is reachable and its version.

## Acceptance criteria
Each one is testable and names how it is checked.

### Domains and layers (Nx, between projects)
1. Given every frontend Nx project under `libs/web/` and `libs/ui`, then it carries exactly one `domain:` tag (`domain:<name>` or `domain:shared`) and one `type:` tag (`type:feature`, `type:ui`, `type:data-access`, `type:model`, `type:util`, `type:api`); `apps/web` carries `type:app`. A frontend project missing either fails verification — *check:* the tag check from spec 001 criterion 4, extended, plus unit tests against fixture lists.
2. Given the root ESLint `depConstraints`, then these edges are allowed and every other edge between frontend projects fails lint:
   - `type:app` → `type:feature`, `type:ui`, `type:util`, `type:model`, `type:api`, `type:data-access` only for app-wide providers;
   - `type:feature` → `type:ui`, `type:data-access`, `type:model`, `type:util`;
   - `type:data-access` → `type:model`, `type:util`, `type:contracts`;
   - `type:ui` → `type:model`, `type:util`;
   - `type:model` → `type:util`;
   - `type:util` → `type:util`;
   - `type:api` → its own domain's `type:feature`, `type:ui`, `type:data-access`, `type:model` (re-export only, see criterion 4);
   - `domain:X` → `domain:X`, `domain:shared`, and `type:api` of another domain; never another domain's other types;
   - `domain:shared` → `domain:shared` only
   — *check:* the lint-rule test harness from spec 001 (`tools/eslint/boundaries.spec.ts`) gets one fixture per allowed edge (no error) and one per forbidden edge (exactly one boundary error).
3. Given `apps/web`, then it holds only bootstrap, app config, root routes (lazy `loadChildren`/`loadComponent` into feature libs) and the root component; no component other than the root component and no service is declared in it — *check:* a Sheriff rule on `apps/web/src` plus a lint fixture that adds a component file in `apps/web` and expects an error.
4. Given a `type:api` lib, then its `index.ts` contains only `export … from` statements — *check:* lint rule (`no-restricted-syntax` scoped to `libs/web/*/api/src/index.ts`) and a fixture with a declaration that must fail.

### Inside projects (Sheriff)
5. Given Sheriff (`@softarc/sheriff-core` with `@softarc/eslint-plugin-sheriff`) configured in `sheriff.config.ts`, when a file imports another project's file by a path past its public `index.ts`, or imports a folder module inside a project past that module's `index.ts`, then lint fails with Sheriff's `deep-import` error — *check:* lint fixtures in the boundaries harness.
6. Given Sheriff and Nx both run, then no rule is defined twice: Nx owns rules between projects, Sheriff owns rules inside a project, and ADR-003 lists which tool owns which rule — *check:* spec-reviewer against ADR-003 and the two configs.

### What code may do
7. Given a file outside a `type:data-access` lib, when it imports from `@angular/common/http` or uses `fetch`, `XMLHttpRequest`, `WebSocket` or `EventSource`, then lint fails; inside `type:data-access` it passes — *check:* lint fixtures for each case.
8. Given a `type:data-access` lib, when the type argument of `HttpClient` methods or `httpResource` is not a type exported by `@helmstead/api-contracts`, then lint fails (custom typed rule in `tools/eslint/rules/`); `any` and `unknown` as that type argument also fail — *check:* rule unit tests with ESLint `RuleTester`: one valid case with a contract type, invalid cases with a local interface, `any` and `unknown`.
9. Given the TypeScript config for all frontend projects, then `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` and Angular `strictTemplates` are on, and `@typescript-eslint/no-explicit-any` and the `no-unsafe-*` rules are errors — *check:* a test that reads the effective tsconfig and ESLint config for each frontend project and asserts these settings.

### Modern Angular only
10. Given angular-eslint, when a fixture uses any of these, then lint fails: an `@NgModule`; a component that is not standalone; a component without `ChangeDetectionStrategy.OnPush`; `@Input`/`@Output`/`@ViewChild`/`@ContentChild` decorators instead of `input()`/`output()`/`viewChild()`/`contentChild()`; constructor injection instead of `inject()`; `*ngIf`/`*ngFor`/`*ngSwitch` instead of `@if`/`@for`/`@switch`; a non-self-closing empty component tag — *check:* lint fixtures, one per pattern.
11. Given `apps/web`, then it runs zoneless: `provideZonelessChangeDetection()` is provided and `zone.js` is neither a dependency nor in the polyfills — *check:* unit test that inspects the app config providers, and a test that reads `project.json`/`package.json` for `zone.js`.

### Design tokens and accessibility
12. Given `libs/ui` (`domain:shared`, `type:ui`), then it holds the Helm design system tokens as CSS custom properties (`--helm-*`) for both themes, Night harbor (dark) and Day (light), ported from the design system artifact, and `apps/web` loads them globally — *check:* screenshot of the status badge in both themes compared with the design system's badge/status styles, attached to the PR.
13. Given Stylelint on all component and global styles under `apps/web` and `libs/`, when a style declares a raw colour (hex, `rgb()`, `hsl()`, named colour), a raw length for spacing (`margin`, `padding`, `gap`, `inset`) or a raw `font-size`/`font-family`/`border-radius`, then Stylelint fails; `var(--helm-*)`, `0`, `inherit`, `transparent` and `currentColor` pass. Only the token files in `libs/ui` are exempt — *check:* Stylelint fixtures (one failing per property group, one passing) run by a test; `verify.mjs` runs Stylelint.
14. Given angular-eslint's template accessibility rules (the `templateAccessibility` config), when a fixture template has e.g. an image without `alt`, a click handler without a key handler, or a form control without a label, then lint fails — *check:* lint fixtures.

### The example domain: system status
15. Given `libs/web/system/{model,data-access,ui,feature,api}`, then `data-access` exposes a `SystemStatusService` that calls `GET /health` with `httpResource` typed with the contract's health type, and a base-URL injection token (`CORE_BASE_URL`) that the sidecar spec will set; `ui` has a presentational `StatusBadgeComponent` taking a status via `input()`; `feature` composes them; `api` re-exports the badge for other domains — *check:* unit test of the service with Angular's `HttpTestingController` and a recorded `/health` fixture.
16. Given the app root, then it renders the status badge with three states: *Connecting…* while the request is pending, *Connected · v{version}* on `200`, and *Core unreachable* with a *Retry* button on any error or timeout (5 s); Retry re-issues the request — *check:* component tests for each state and for Retry (no live calls; fixtures only).
17. Given `ng serve`, then a dev proxy (`apps/web/proxy.conf.json`) forwards `/health` to the core's fixed development URL on `127.0.0.1`, and the core's development profile uses that port — *check:* manual run shown in the PR (screenshot of *Connected · v…* with the core running, and of *Core unreachable* with it stopped).

### Rules guard themselves, docs
18. Given `scripts/sdlc/risk-paths.json`, then `sheriff.config.ts`, `.stylelintrc*`/`stylelint.config.*`, `tools/eslint/**` and `libs/ui/src/tokens/**` are added to the architecture category — *check:* `node scripts/sdlc/classify-risk.mjs` output on this branch, in the PR.
19. Given `docs/adr/003-frontend-architecture.md`, then it records the domain/type scheme, the allowed edges of criterion 2, the Nx-vs-Sheriff ownership, the HTTP and contract rules, modern-Angular-only, signal services for state (no store library), and the token rule; `docs/adr/002-module-boundaries.md` links to it — *check:* spec-reviewer.
20. Given `CLAUDE.md`, then it gains a short "Frontend" section: where a new feature goes (`libs/web/<domain>/<type>`), the Nx generator command to create a correctly tagged lib, and a pointer to ADR-003 — *check:* spec-reviewer; the generator command is run once in the PR (and the generated lib removed again).

## Out of scope
- Layout, navigation and the Home view (later Phase 0 / Phase 2 specs). The badge sits in the root component until the layout spec gives it a place.
- Session token handling, the sidecar's random port and setting `CORE_BASE_URL` at runtime (sidecar spec).
- Porting Helm components beyond the tokens and the status badge styles.
- Polling `/health`; it is fetched once on load and on Retry.
- State libraries (NgRx or similar).
- E2E tests (plan §9 smoke test arrives with the shell).
- Secret scanning, dependency policy, live-call ban (spec 003).

## Decisions from the interview
- Frontend architecture is its own spec (split from 001 when the owner asked why the frontend was missing).
- Owner's direction → implement Nx, enforce domain-driven design, use Sheriff to enforce DDD, use ESLint to enforce the Angular standards.
- Rules wanted → HTTP only in data-access; contract types only; modern Angular only; design tokens + accessibility.
- Where features live → libs per domain (`libs/web/<domain>/<type>`), `apps/web` is a thin shell.
- Nx vs Sheriff → Nx owns rules between projects, Sheriff owns rules inside a project (folders, no deep imports).
- Cross-domain use → only through the other domain's `type:api` lib, plus `domain:shared`.
- Example domain → system status badge calling `/health` through a dev proxy.
- Layer types → feature, ui, data-access, model, util, api, with the edges in criterion 2.
- Tokens → port the Helm design system tokens now; Stylelint enforces them.
- State → plain signal services with `resource`/`httpResource`, no store library.

## Risk forecast
High risk: this spec defines the frontend rules every later UI change is judged by, and adds dependencies.

- **Architecture & contracts** — root ESLint config, every new `project.json` (tags), `tsconfig.base.json` (path aliases), `docs/adr/003-*`, `libs/api-contracts` consumers. Owner focus: the `depConstraints` block (do the edges match criterion 2 exactly, with no wildcard that silently allows more?), `sheriff.config.ts`, and the custom contract-type rule in `tools/eslint/rules/` (can it be fooled by a type alias of a local interface?).
- **Dependencies & pipeline** — `package.json`/lock: `@softarc/sheriff-core`, `@softarc/eslint-plugin-sheriff`, `stylelint` and the plugin used for strict values (e.g. `stylelint-declaration-strict-value`), angular-eslint if not already present; `scripts/sdlc/verify.mjs` (adds Stylelint); `scripts/sdlc/risk-paths.json`; `CLAUDE.md`. Owner focus: the new packages and their licences, and that `verify.mjs` fails when Stylelint fails.
- **Security** — none beyond the dev proxy, which must target `127.0.0.1` only. Owner focus: `apps/web/proxy.conf.json`.
- **Size** — may approach 1000 lines with fixtures; fixtures and generated lib boilerplate are "safe to skim".

## Notes for the build
- **Depends on spec 001.** Do not start until 001 is merged to `main`; rebase this branch onto it. Reuse 001's boundaries test harness and tag check rather than writing new ones.
- Helm design system (namespace `Helm`, dark "Night harbor" and light "Day"): https://claude.ai/artifact/XQDpkg4gRzfwJRABL1gxjg — read it with the Artifact tool, port its CSS custom properties into `libs/ui/src/tokens/`. The Home mockup (https://claude.ai/artifact/PPcFZbbh91eNJaKae2EpgZ) shows how status is presented.
- Verify current versions and rule names before configuring (plan §10 rule 3): angular-eslint rule names (`prefer-standalone`, `prefer-on-push-component-change-detection`, `prefer-signals`, `prefer-inject`, `template/prefer-control-flow`, `template/prefer-self-closing-tags`, the accessibility config), Sheriff's config format and ESLint flat-config support, `httpResource` API status in the current Angular version.
- Use Nx generators with `--tags` to create the libs so tags and paths are consistent; an Nx workspace generator for "domain lib" is welcome if it stays small.
- Fixtures for lint and Stylelint must be excluded from real builds and from the real tag check.
- The recorded `/health` fixture should match the contract type generated in 001.

## Open questions
