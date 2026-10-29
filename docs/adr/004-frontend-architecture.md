# 004 — Frontend architecture

- Status: accepted
- Date: 2026-10-29
- Spec: [002 — Frontend architecture and Angular guard rails](../specs/002-frontend-architecture.md)

## Context

[ADR 002](002-module-boundaries.md) gave the Angular side coarse `scope:` rules, but nothing said where frontend code
belongs or how it is written. Without enforced domains, layers and Angular standards, AI-written features drift into one
tangled app: components that call HTTP, hand-written copies of API types, legacy Angular patterns and hard-coded styles
that ignore the Helm design system. The owner chose domain-driven libs per domain, Nx for the rules between projects,
Sheriff for the rules inside a project, and ESLint and Stylelint for the code rules.

## Decision

Every rule below fails `node scripts/sdlc/verify.mjs` and CI when it is broken. The rules, their configs and their tests
are architecture paths in `scripts/sdlc/risk-paths.json`, so changing one is high risk and waits for the owner.

### Domains and layers

Frontend code lives in Nx libs under `libs/web/<domain>/<type>`. `apps/web` is a thin shell. Every frontend project
carries one `domain:` and one `type:` tag next to its `scope:web` tag, and its folder matches them
(`tools/workspace/scope-tags.ts`; a `scope:web` lib anywhere else fails):

| Tag                                   | Meaning                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `domain:<name>`                       | A business domain, e.g. `domain:system`. Listed in `tools/workspace/frontend-tags.mjs`. |
| `domain:shared`                       | Used by every domain: `libs/ui` (design tokens), `libs/api-contracts`.      |
| `type:feature`                        | Smart components and routes of a use case.                                 |
| `type:ui`                             | Presentational components: inputs in, outputs out, no services.             |
| `type:data-access`                    | Services that talk to the core, and app-wide HTTP providers.                |
| `type:model`                          | The domain's types, as the frontend uses them.                              |
| `type:util`                           | Pure functions.                                                            |
| `type:api`                            | What a domain offers other domains; re-exports only.                        |
| `type:app`                            | `apps/web`, no domain.                                                     |
| `type:contracts`                      | `libs/api-contracts`, the types generated from the core's OpenAPI document. |

A project satisfies every `depConstraints` entry whose tag it carries (root `eslint.config.mjs`), so an import passes
only when its scope, its type and its domain all allow it. The allowed edges, and no others:

| From               | May import                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `type:app`         | `type:feature`, `type:ui`, `type:util`, `type:model`, `type:api`; `type:data-access` only in `src/app/app.config.ts`, for app-wide providers (and in tests) |
| `type:feature`     | `type:ui`, `type:data-access`, `type:model`, `type:util`, and another domain's `type:api`           |
| `type:data-access` | `type:model`, `type:util`, `type:contracts`                                                         |
| `type:ui`          | `type:model`, `type:util`                                                                           |
| `type:model`       | `type:util`                                                                                         |
| `type:util`        | `type:util`                                                                                         |
| `type:api`         | its own domain's `type:feature`, `type:ui`, `type:data-access`, `type:model`                        |
| `domain:X`         | `domain:X`, `domain:shared`, and `type:api` of another domain                                       |
| `domain:shared`    | `domain:shared`                                                                                     |

Notes on the table:

- `type:feature` lists `type:api` so a feature can use another domain through its api lib. Tags cannot say "another
  domain", so `tools/eslint/eslint.web.config.mjs` reads the project's own domain and forbids `@helmstead/<own
  domain>-api` in a feature, and anything but `@helmstead/<own domain>-*` in an api lib (import aliases are
  `@helmstead/<domain>-<type>`).
- `type:api` lists no `type:api`, so an api lib cannot re-export another domain.
- The domain rule needs one constraint per domain. `eslint.config.mjs` builds it from `FRONTEND_DOMAINS` in
  `tools/workspace/frontend-tags.mjs`, and the tag check fails a project whose domain is not in that list, so a new
  domain cannot exist without its rule.
- A `type:api` lib's `src/index.ts` contains only `export … from` statements (`no-restricted-syntax`).
- `apps/web` declares one class, the root component in `src/app/app.ts`. Any other class, and any service, directive
  or pipe in `app.ts`, fails lint. Bootstrap, app config and root routes (`loadChildren`/`loadComponent` into feature
  libs) are all the app holds.

The edges are tested in `tools/eslint/boundaries.spec.ts` with one fixture per allowed edge (no error) and one per
forbidden edge (exactly one error). Fixture projects for types and domains the workspace does not have yet live in
`tools/eslint/fixtures/projects`; the tag checks skip them and no real code may import them.

### Which tool owns which rule

No rule is defined twice.

| Rule                                                                 | Owner                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------- |
| Edges between projects (scope, type, domain), app ↛ app, cycles      | Nx `@nx/enforce-module-boundaries` (`depConstraints`)       |
| A feature ↛ its own api lib; an api lib re-exports only its own domain | ESLint `no-restricted-imports`, from the project's domain tag |
| Buildable libs import only buildable libs                            | Nx `@nx/enforce-module-boundaries`                          |
| Tags present and known                                               | `tools/workspace/scope-tags.ts` (guard-rail tests)          |
| No import past a project's `index.ts`, or past a folder module's `index.ts` inside a project | Sheriff `@softarc/sheriff/deep-import` (`sheriff.config.ts`) |
| HTTP, contract types, thin app shell, api re-exports, Angular style  | ESLint (`tools/eslint/eslint.web.config.mjs`)               |
| Design tokens in styles                                              | Stylelint (`stylelint.config.mjs`)                          |

Sheriff tags no modules and its `dependency-rule` is off: tagging modules in Sheriff would define the project rules a
second time. One import is reported by both: a relative import into another project's internals is a relative
cross-project import for Nx and a deep import for Sheriff. That is the same rule seen from two sides, not two rules to
keep in step. Sheriff only sees imports, so the thin-shell rule for `apps/web` is an ESLint rule.

### What code may do

- **HTTP only in data-access.** Outside a `type:data-access` lib, an import from `@angular/common/http` (and its
  subpaths), and `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource` (also as `window.`/`globalThis.`/`self.`
  properties) fail lint. The app gets its HTTP client from a data-access lib (`provideCoreHttp()`). This keeps code
  in its place; it is not the network boundary. Other APIs (`navigator.sendBeacon`, a remote `import()`) are not
  covered, and the shipped app limits where it may connect with the shell's content security policy (`connect-src`).
- **Contract types only.** In a data-access lib, the type argument of every `HttpClient` method and of `httpResource`
  must resolve to a type declared in `libs/api-contracts/src/generated` (`helmstead/contract-types`, a typed rule in
  `tools/eslint/rules/`). Calls are found by the signature they resolve to, so an alias of `httpResource` or a subclass
  of `HttpClient` is checked too; data-access libs use `HttpClient` and `httpResource`, nothing else. It checks the
  resolved type, including the arguments of a generic alias, and accepts a lookup into a contract type
  (`components['schemas']['X']['status']`, for schemas that resolve to a primitive or literal union) and `void` (no
  content). Calls that cannot take a type argument (`responseType: 'text'`, `httpResource.text`) need none. Since the
  rule cannot be switched off for a line, a false positive is fixed in the rule. An alias of a local interface, a local interface that extends
  a contract type, an intersection with a local type, `any`, `unknown` and a missing type argument all fail. Map the
  contract type to a model type after the call.
- **Strict TypeScript.** `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` and Angular `strictTemplates` are on
  in every frontend tsconfig; `@typescript-eslint/no-explicit-any` and every `no-unsafe-*` rule are errors, with
  type-aware linting (`tools/eslint/strictness.spec.ts`).
- **No switching off.** A disable comment for any of these rules, for Sheriff, `no-explicit-any` or a `no-unsafe-*`
  rule is itself a lint error (`no-restricted-disable` in the root config). A project's `eslint.config.mjs` is the
  one-line shared config; a test fails any other.
- Lint fixtures for these rules are in `tools/eslint/http.spec.ts` and `tools/eslint/rules/contract-types.spec.ts`.

### Modern Angular only

Standalone components, no `@NgModule`; OnPush (Angular 22's default, so opting out fails); `input()`, `output()`,
`viewChild()`, `contentChild()` instead of the decorators; `inject()` instead of constructor injection; `@if`, `@for`,
`@switch` instead of the structural directives; self-closing empty tags; styles in a `.css` file, not inline. The app
runs zoneless (`provideZonelessChangeDetection()`, no `zone.js`). Rules: `tools/eslint/eslint.angular.config.mjs`;
fixtures: `tools/eslint/angular.spec.ts`.

`@angular-eslint/template/no-call-expression` is off: it reports every signal read in a template, and signals are the
rule here.

### State

State lives in plain services built on signals, `resource` and `httpResource`. No store library (NgRx or similar).

### Design tokens and accessibility

- `libs/ui/src/tokens/` holds the Helm design system tokens as `--helm-*` custom properties: `helm-tokens.css` is
  generated from a verbatim copy of the design system's `tokens.json` (`tools/design/port-helm-tokens.mjs`; a test fails
  when they disagree), `helm-components.css` holds component measurements ported from the design system's components.
  Night harbor (dark) is the default; `data-theme="light"` on the root element switches to Day. `apps/web` loads both
  files globally.
- Stylelint fails a raw colour (hex, colour functions, named colours) anywhere, and a raw value for spacing (`margin`,
  `padding`, `gap`, `inset` and their longhands), `font`, `font-size`, `font-family` or `border-radius`. Only
  `var(--helm-*)`, `0`, `inherit`, `transparent` and `currentColor` pass. `--helm-*` properties are declared only in the
  token files, which are the one exemption. Disable comments are ignored and reported, and `verify.mjs` always runs
  the root config.
  Frontend styles are plain CSS.
- angular-eslint's `templateAccessibility` rules are errors in every template.

### Adding to the frontend

- A new lib: the generator command and the follow-up steps are in `CLAUDE.md` (Frontend). The generator sets the
  tags and, from `nx.json`, buildable, CSS and prefix `hs`; the guard-rail tests fail until the lib also has the shared
  ESLint config, `noUncheckedIndexedAccess` and its place in the workspace project list.
- A new domain: add it to `FRONTEND_DOMAINS` in `tools/workspace/frontend-tags.mjs` (high risk, owner review).

## Consequences

- An agent that puts HTTP in a component, copies an API type, adds a module or hard-codes a colour gets a failing
  build with a message that says where the code belongs.
- Frontend libs are buildable (the Angular test runner needs a build target), so `libs/api-contracts` builds with
  `@nx/js:tsc` into `dist/` instead of a type check only; buildable libs that import it compile against that output.
- Typed linting makes `nx lint` of frontend projects slower. The fixture tests lint without types and cover the
  type-aware rules with their own `RuleTester` and config tests.
- The font families of the design system (Bricolage Grotesque, Hanken Grotesk, JetBrains Mono) are not loaded yet: the
  app makes no request to a font CDN and falls back to the system fonts in each stack until font files are bundled.
- `CORE_BASE_URL` is empty in development, so requests go to the dev server, whose proxy (`apps/web/proxy.conf.json`)
  forwards `/health` to the core on `http://127.0.0.1:5108`. The sidecar spec sets it to the core's random port and
  adds the session token.
