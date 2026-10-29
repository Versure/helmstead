# 002 — Module boundaries

- Status: accepted
- Date: 2026-10-29

## Context

Plan §2 and §10 rule 5 require that the harness, the model and the connectors stay separate, and that the domain
depends on nothing. Until now these rules existed only as prose, so an agent could break them without anything
failing. The repository has two halves that meet only through a contract: an Angular frontend and a .NET core.

## Decision

The boundaries below are enforced by tests and lint, and they run in `node scripts/sdlc/verify.mjs` and in CI on
Windows, macOS and Linux. Changing any of them is high risk and waits for the owner.

### Workspace (Nx)

Every Nx project carries exactly one `scope:` tag. A project without one, with two, or with an unknown one fails
verification (`tools/workspace/scope-tags.spec.ts`).

| Tag            | Projects                   |
| -------------- | -------------------------- |
| `scope:web`    | `apps/web`, `libs/ui`      |
| `scope:core`   | `apps/core`                |
| `scope:shared` | `libs/api-contracts`       |

`@nx/enforce-module-boundaries` in the root `eslint.config.mjs` allows these edges and no others:

- `scope:web` may import `scope:web` and `scope:shared`.
- `scope:core` may import `scope:core` and `scope:shared`.
- `scope:shared` may import `scope:shared` only.
- An application never imports another application.

The rule cannot be switched off with a comment: `eslint-disable` for `@nx/enforce-module-boundaries`, on a line or for
a file, is itself a lint error. The rule and this ban are tested with fixtures in `tools/eslint/boundaries.spec.ts`.

The frontend and the core meet only through `libs/api-contracts`. The core produces `libs/api-contracts/openapi.json`
at build time, the TypeScript types in `libs/api-contracts/src/generated/` are generated from it, and
`nx run api-contracts:check` fails when the committed files differ from a fresh generation.

### Core (.NET)

Every `.csproj` is an Nx project (the `@nx/dotnet` plugin infers them): `core` is `Helmstead.Core.Api`, `core-tests` the
tests, and each fixture a build-only project. All carry `scope:core`.

ArchUnitNET rules in `apps/core/tests/Helmstead.Core.Tests/Architecture/` apply to assemblies and namespaces found by
pattern, so a project or slice added later is covered without editing the tests. The slice and CQRS rules are in
[ADR 003](003-vertical-slices-and-cqrs.md). The rules between assemblies are:

- Domain code (`...Features.<Slice>.Domain`) references no ASP.NET Core, no EF Core and no `System.Net.Http`.
- Only `Helmstead.Core.Api` references ASP.NET Core.
- A `Helmstead.Connectors.*` assembly references no other connector, nor `Helmstead.Agents`, nor `Helmstead.Providers`.
- `Helmstead.Agents` references no `Helmstead.Connectors.*`.
- `Helmstead.Providers` references no `Helmstead.Connectors.*` and no `Helmstead.Agents`.

Each rule has a deliberately violating fixture under `apps/core/tests/fixtures/`, and a test asserts that the rule
fails on it. This proves the rules can fail. The fixtures are not part of any real scan.

### Rules still to come

- Bounded-context rules inside the .NET core are added by the specs that create those modules.
- Frontend domain-driven layout (`domain:` and `type:` tags, Sheriff inside projects, HTTP only in data-access) follows
  in spec 002.

### The rules guard themselves

The ESLint config, project tags, formatting config, the architecture tests and their fixtures, and `tools/` are listed in
`scripts/sdlc/risk-paths.json` as architecture paths. A pull request that touches them is high risk.

## Consequences

- An agent that crosses a boundary gets a failing build and a message, not a review comment a week later.
- The `scope:` scheme is deliberately coarse. It is extended by spec 002, not worked around.
- **Known gap:** `GET /health` has no session token. It listens on `127.0.0.1` only and refuses to start on any other
  address, but another local process can call it. The sidecar spec (plan §3.3) adds the token and the 401 on a missing
  one, and closes this gap.
- `AllowedHosts` is limited to `127.0.0.1` and `localhost`, which blocks requests that arrive under another host name
  (DNS rebinding). It is not authentication.
- `libs/api-contracts` declares `core` as an implicit dependency. That is the one intended exception to "shared
  depends on shared only": it records that the contract is produced by the core, so a core change re-runs the
  contract check. `@nx/enforce-module-boundaries` only checks imports, so it does not see this edge.
- A `dotnet build` of `Helmstead.Core.Api` writes `libs/api-contracts/openapi.json` (build-time OpenAPI generation).
  Nx cannot see that write, so `core:build` is never cached. Once the core's startup does real work (a database,
  an app data folder), startup must be skipped when the OpenAPI generator starts the app, or generation must move
  to the Nx target only.
- Every project under `apps/core/src` must match one of the assembly name patterns of the rules, or a test fails.
  Connectors may not share a `Helmstead.Connectors.*` assembly, because a connector may not reference another one;
  shared connector contracts belong in the shared kernel (`Helmstead.Core.Api.Shared`), or a new ADR must change the rule.
- The `@nx/dotnet` targets build with `--no-restore`, so `verify.mjs` and CI restore NuGet packages once first
  (`dotnet restore apps/core/Helmstead.Core.slnx`). After a fresh clone, run that before `npx nx build core`.
- The relative-path edge cases (web or ui importing the core by a relative path) are rejected by Nx for any
  project-to-project relative import, whatever the tags. Tag-based rejection for those pairs is only visible when the
  core has TypeScript with an import alias, which it does not have.
