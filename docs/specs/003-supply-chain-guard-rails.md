---
id: 003
title: Supply-chain and test hygiene guard rails
status: built             # draft | approved | built
type: feature            # feature | fix | chore | spike
plan-phase: 0            # docs/plan.md §8
branch: feat/003-supply-chain-guard-rails
---

# 003 — Supply-chain and test hygiene guard rails

## Problem
Helmstead is built mostly by AI agents that add dependencies, write tests and commit on their own. Nothing stops them from committing a token, pulling in a package with a known high-severity vulnerability or a copyleft licence, or writing a test that calls a live API (plan §9 forbids it, but only in prose). Specs 001 and 002 guard the architecture. This spec guards what goes into the repo and what tests may reach.

## Outcome
A commit by Claude that contains a secret is blocked before it is made, and any secret in a PR's commits makes CI fail. A dependency with a disallowed or missing licence, or with an unexcepted high or critical advisory, makes CI fail. A test that opens a non-loopback network connection fails, in Vitest and in xUnit, locally and in CI. A weekly run on `main` catches new advisories and old secrets and opens an issue. Every exception is a reviewed, high-risk change with a reason, and vulnerability exceptions also have an expiry date.

## Acceptance criteria
Each one is testable and names how it is checked.

### Policy file
1. Given the repo root, then `dependency-policy.json` holds:
   - `licenses.shipped`: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense;
   - `licenses.tooling`: additionally MPL-2.0, BlueOak-1.0.0, MIT-0, CC0-1.0, CC-BY-4.0, Python-2.0;
   - `licenseExceptions`: a list of `{ ecosystem, package, versionRange, reason }`;
   - `vulnerabilityExceptions`: a list of `{ ecosystem, package, advisory, reason, expires }` (ISO date).

   A JSON schema validates the file. An exception without a reason, or a vulnerability exception without an expiry date, fails validation.
   — *check:* unit tests of the schema against valid and invalid fixtures in `tools/supply-chain/`.
2. Given `scripts/sdlc/risk-paths.json`, then `dependency-policy.json`, `.gitleaks.toml`, `.gitleaksignore`, `tools/supply-chain/**`, the network-guard files (criteria 13–16) and `scripts/sdlc/hooks/**` are classified high risk. Only entries are added; none are loosened.
   — *check:* `node scripts/sdlc/classify-risk.mjs` output on this branch, included in the PR.

### Licences (offline, part of `verify.mjs`)
3. Given `package-lock.json`, then every package is classified as *shipped* (no `dev` flag) or *tooling* (`dev: true`). Shipped packages must declare an SPDX expression that is satisfied by `licenses.shipped`; tooling packages need one satisfied by `shipped ∪ tooling`. An `OR` expression passes when one side is allowed; an `AND` expression passes only when every part is allowed. A missing, non-SPDX or `UNLICENSED` licence fails. Packages under a matching `licenseExceptions` entry pass. The root workspace package itself is skipped.
   — *check:* unit tests of the classifier and SPDX evaluation against fixture lock files. Cases: shipped MPL fails, tooling MPL passes, `(MIT OR CC0-1.0)` passes, `(Apache-2.0 AND BSD-3-Clause)` passes, `(MIT AND GPL-3.0)` fails, missing licence fails, an exception passes, an exception for another version range does not.
4. Given the NuGet packages restored for `apps/core/Helmstead.Core.slnx` (direct and transitive, read from each project's `obj/project.assets.json` and the package's `.nuspec` in the global packages folder), then packages reached only from test projects (`*.Tests` and the fixture projects) are *tooling* and all others are *shipped*, with the same licence rules as criterion 3. A nuspec that only has `licenseUrl`, or a licence `type="file"`, counts as no SPDX licence and needs an exception.
   — *check:* unit tests against fixture assets and nuspec files, plus the real run in criterion 6.
5. Given a failing package, then the output names the ecosystem, package, version, the licence found, the tier and the dependency path that pulled it in, and says how to add an exception.
   — *check:* snapshot of the failure message in the unit tests.
6. Given the current repo, then the licence check passes. Every current outlier is either covered by the tooling tier or has a `licenseExceptions` entry with a reason; `svg-tags` and `union` have no declared licence. `verify.mjs` runs the check on every run, not only when dependencies change. Like every other step, it fails the run when it fails or cannot start.
   — *check:* the `ci` workflow is green, and a one-off failing run (with a temporarily disallowed licence in a fixture copy) is shown in the PR.

### Vulnerabilities (online, CI only)
7. Given a PR, then a `dependency-policy` job in `ci.yml` runs `npm audit --json` and `dotnet list apps/core/Helmstead.Core.slnx package --vulnerable --include-transitive --format json`. Every high or critical advisory, in shipped and tooling dependencies alike, fails the job unless a `vulnerabilityExceptions` entry matches its ecosystem, package and advisory ID and has not expired. The job also runs the licence check (criterion 3) and validates the policy file (criterion 1).
   — *check:* unit tests of the advisory filter against recorded `npm audit` and `dotnet list` JSON fixtures. Cases: high fails, moderate passes, an excepted high passes, an expired exception fails, and an exception for a different advisory on the same package does not apply.
8. Given an exception whose `expires` date is in the past, then the check fails even when the advisory no longer exists, so stale entries get removed.
   — *check:* unit test.
9. Given the `ci` aggregate job, then it needs `verify`, `dependency-policy` and `secret-scan`, and it is red when any of them did not succeed. Branch protection does not change.
   — *check:* a workspace test that parses `ci.yml` and asserts the `needs` list and the success test, plus the `ci` workflow being green.

### Secrets
10. Given Claude runs `git commit` through Bash or PowerShell, then a PreToolUse hook (`scripts/sdlc/hooks/scan-secrets.mjs`, registered in `.claude/settings.json` next to `guard-shell.mjs`) runs `gitleaks git --staged` (or the pinned version's equivalent) with the repo's `.gitleaks.toml`. A finding blocks the command with exit code 2. The message names the rule, file and line and never prints the secret. The hook also covers `git commit -a` and `git commit <paths>`: it scans what that commit would include.
    — *check:* unit tests that run the hook against a temporary git repo with a staged fake token (a known-format test key built at runtime, never committed as a literal), once with `-a` and an unstaged change, and once with a clean change.
11. Given gitleaks is not on the PATH, then the hook downloads the release pinned in `tools/supply-chain/gitleaks.json` (version, plus a URL and SHA-256 per OS/arch for Windows, macOS and Linux on x64 and arm64) into a cache folder outside the repo. It verifies the checksum before extracting or running anything, then reuses the cached binary. A checksum mismatch deletes the download and blocks. Being offline with no cached binary blocks the commit with a clear message. A gitleaks on the PATH is used only if its version matches the pin.
    — *check:* unit tests with a local fixture archive served from loopback: a good checksum runs, a bad checksum blocks and deletes, no network and no cache blocks, and a cache hit makes no request.
12. Given a PR, then a `secret-scan` job in `ci.yml` installs the same pinned, checksummed gitleaks with the same download code and scans every commit in the PR range (`base..head`), so a secret added and later removed still fails. The weekly run scans the full history of `main`.
    — *check:* the job is green on this PR, and a one-off failing run on a temporary commit with a generated fake key, then reverted and removed from the branch before review, is shown in the PR.

### No live network in tests
13. Given any Vitest run in the workspace (the `tools/` guard-rail tests, `libs/api-contracts` and every Angular project through the `@angular/build` unit-test builder), then a shared setup file `tools/testing/no-network.ts` is loaded. It makes these throw an error naming the host and pointing to plan §9:
    - `net.Socket#connect`, `tls.connect`, `http(s).request` and global `fetch` to a non-loopback host;
    - DNS lookups of any name other than `localhost`.

    Loopback (`127.0.0.0/8`, `::1`, `localhost`) is allowed.
    — *check:* fixture tests that try each API against a non-loopback address (`192.0.2.1`, TEST-NET, which is never routed) and assert the error, plus a loopback test that succeeds.
14. Given the workspace, then every Vitest config and every Angular `test` target registers that setup file, and a project without it fails.
    — *check:* a workspace test like `tools/workspace/scope-tags.spec.ts` that reads the Nx project graph, plus a negative fixture.
15. Given any .NET test project, then a `[ModuleInitializer]` from a shared source file (`apps/core/tests/Shared/NoNetwork.cs`, linked by `apps/core/tests/Directory.Build.props`) sets `HttpClient.DefaultProxy` to an unreachable loopback proxy that bypasses loopback addresses. An ArchUnitNET rule forbids test code from using `System.Net.Sockets.Socket`, `TcpClient`, `UdpClient`, `HttpClientHandler.UseProxy`/`SocketsHttpHandler.UseProxy` and `WebProxy`, except in `NoNetwork.cs`. `WebApplicationFactory` and fake `HttpMessageHandler`s still work.
    — *check:* xUnit tests:
    - an `HttpClient` call to `http://192.0.2.1/` fails fast with the guard's error;
    - a call to the in-memory `WebApplicationFactory` client succeeds;
    - the ArchUnitNET rule fails on a fixture type in the fixtures project;
    - every `*.Tests` project in the solution contains the module initializer.
16. Given a test that really needs a live API, then it is marked: Vitest files named `*.live.spec.ts`, which are excluded from every normal test include, and xUnit tests with `[Trait("Category", "Live")]`, which `verify.mjs` and CI filter out. It runs only with `HELMSTEAD_LIVE_TESTS=1`, which lifts the guards. No live tests are added in this spec.
    — *check:*
    - a test that the guard is lifted only with the variable;
    - a workspace test that no workflow under `.github/workflows/` sets `HELMSTEAD_LIVE_TESTS`, and that the default test includes match no `*.live.spec.ts`;
    - the dotnet test step in `verify.mjs` passes `Category!=Live`.

### Weekly run
17. Given `.github/workflows/supply-chain-weekly.yml`, then it runs on a weekly schedule and on manual dispatch against `main`. It runs the vulnerability check, the licence check and a full-history gitleaks scan. On failure it opens a GitHub issue titled `Weekly supply-chain check failed`, or comments on an open one, with the findings (secrets redacted) and a link to the run. Its permissions are `contents: read` and `issues: write` and nothing else.
    — *check:* a workspace test on the workflow (schedule, permissions, steps), plus one manual dispatch shown in the PR description after merge (or explicitly marked as not possible before merge).

### Documentation
18. Given `docs/adr/`, then `005-supply-chain-policy.md` records:
    - the two licence tiers and why tooling gets a wider list;
    - the vulnerability threshold and the expiring exceptions;
    - gitleaks pinned and checksummed instead of the paid action;
    - the network guards and the live-test escape hatch;
    - that every exception is a high-risk change.

    `docs/sdlc.md` §5 gains rows for secrets, dependency policy and the network ban.
    — *check:* spec-reviewer.
19. Given `CLAUDE.md`, then the Commands section gains how to run the licence check locally, how to add a licence or vulnerability exception (and that it waits for the owner), and how to run live tests.
    — *check:* spec-reviewer, and each command is run once in the PR.

## Out of scope
- A plain git pre-commit hook for human contributors. CI catches their secrets. It can be added later.
- Secret scanning of Claude's commits made outside Bash or PowerShell (for example GitHub MCP `push_files`). CI's PR scan covers these.
- Rust/Cargo dependencies. There is no `apps/shell` yet, so the shell spec extends the policy to Cargo.
- Moderate and low advisories, and Dependabot or Renovate update PRs.
- SBOM generation, signing and provenance (later, with distribution).
- Choosing the project's own licence (plan §11, MIT or Apache-2.0). The checker skips the root package.
- Any live test. Only the mechanism is added.

## Decisions from the interview
- Licence policy → two tiers. Shipped dependencies (npm prod, non-test NuGet) use the strict permissive list. Dev/build/test dependencies may also use MPL-2.0, BlueOak-1.0.0, MIT-0, CC0-1.0, CC-BY-4.0 and Python-2.0. Anything else needs a per-package exception with a reason. Why: today ~30 dev-only packages (lightningcss, caniuse-lite, argparse, minimatch, @csstools/*) fall outside the strict list, while every shipped package fits it.
- Vulnerabilities → high and critical in all dependencies fail on every PR, plus a weekly scheduled run on `main` that opens an issue. Exceptions need a reason and an expiry date.
- Gitleaks when not installed → download a pinned release, verify its SHA-256 against checksums committed in the repo, and cache it. Offline with no cache blocks the commit.
- Network ban → runtime guards on both sides (Vitest setup file; .NET module initializer plus ArchUnitNET rule), proven by fixture tests.
- Tooling → own scripts that read the lock file and NuGet restore output. No new third-party licence checkers, and the licence check runs offline inside `verify.mjs`.
- CI gitleaks range → every commit in the PR, and the full history weekly.
- Live tests → opt-in through file naming or a trait and `HELMSTEAD_LIVE_TESTS=1`, never in CI.
- Where checks report → new jobs in `ci.yml` under the existing required `ci` check. No branch-protection change.
- Defaults I chose (not asked):
  - the policy lives in a root `dependency-policy.json`;
  - the new ADR is 005, since 001 is reserved and 003 and 004 are taken;
  - the hook is a separate script next to `guard-shell.mjs`;
  - findings never print secret values;
  - `.gitleaks.toml` extends gitleaks' default rules;
  - false positives go in `.gitleaksignore` by fingerprint;
  - the cache lives in the OS user cache directory.

## Risk forecast
High risk, by design: this spec adds the rules that judge every dependency and commit.

- **Dependencies & pipeline**: `.github/workflows/ci.yml`, the new `supply-chain-weekly.yml`, `.claude/settings.json`, `scripts/sdlc/hooks/scan-secrets.mjs`, `scripts/sdlc/verify.mjs`, `scripts/sdlc/risk-paths.json`, `CLAUDE.md`, `docs/sdlc.md`. Owner focus:
  - the `ci` aggregate's `needs` and success condition: can a skipped job read as green?
  - the weekly workflow's `permissions` block;
  - that the hook blocks, and does not allow, when gitleaks can't be obtained;
  - that `risk-paths.json` only adds entries.
- **Security**: the gitleaks download-and-verify code and `tools/supply-chain/gitleaks.json`. Owner focus:
  - checksums are verified before extract or exec;
  - the pinned URLs point at the official `gitleaks/gitleaks` GitHub releases;
  - the checksums match the official checksum file;
  - no secret value reaches stdout, logs or the weekly issue.

  Also `NoNetwork.cs` and `tools/testing/no-network.ts`: can a test bypass them without tripping the ArchUnitNET or workspace rule?
- **Architecture**: `tools/**`, the new ArchUnitNET rule and fixture, `docs/adr/005-*`. Owner focus: the rule's forbidden-type list.
- **Policy content**: `dependency-policy.json`. Owner focus: the `tooling` licence list and each initial `licenseExceptions` entry with its reason.
- **Size**: probably 900–1200 lines with fixtures. Recorded audit JSON, fixture lock files and nuspecs are "safe to skim".

## Notes for the build
- **Verify current facts before coding (plan §10 rule 3):**
  - the gitleaks release asset names, the checksum file and the CLI for scanning staged changes and a commit range (v8 uses `gitleaks git --staged` and `--log-opts`);
  - the `npm audit --json` and `dotnet list package --vulnerable --format json` output shapes;
  - how the `@angular/build` unit-test builder takes `setupFiles`;
  - whether `HttpClient.DefaultProxy` is honoured by `IHttpClientFactory` clients in .NET 10.
- `.gitleaks.toml` paths and the fake-key tests: build test tokens at runtime from pieces, so the repo itself never holds a string that gitleaks or GitHub push protection flags.
- Today's outliers (from `package-lock.json`):
  - tooling tier: `lightningcss` (+ platform packages, MPL-2.0), `caniuse-lite` (CC-BY-4.0), `argparse` (Python-2.0), `minimatch`/`lru-cache`/`sax` (BlueOak-1.0.0), `@csstools/*` (MIT-0), `mdn-data` (CC0-1.0);
  - OR expressions that already pass: `type-fest` `(MIT OR CC0-1.0)`, `opener` `(WTFPL OR MIT)`;
  - AND expression: `@bufbuild/protobuf` `(Apache-2.0 AND BSD-3-Clause)`;
  - no declared licence: `svg-tags` and `union`. Check their repos for a licence file and add exceptions with what you find.
- NuGet licence data comes from restore output only (no network). `verify.mjs` already restores first.
- Reuse the lint-fixture and tag-check harnesses from 001/002 for the workspace tests. Fixtures stay out of real builds and real scans.
- `tools/vitest.config.mts` (guard rails) also needs the network setup file.

## Open questions
