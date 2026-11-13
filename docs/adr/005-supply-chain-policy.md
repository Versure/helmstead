# 005 — Supply-chain and test hygiene policy

- Status: accepted
- Date: 2026-11-13
- Spec: [003 — Supply-chain and test hygiene guard rails](../specs/003-supply-chain-guard-rails.md)

## Context

Helmstead is built mostly by AI agents that add dependencies, write tests and commit on their own. ADRs 002–004 guard
the architecture. Nothing guarded what goes into the repository: a committed token, a package with a known
high-severity vulnerability or a copyleft licence, or a test that calls a live API (plan §9 forbids it, but only in
prose). This ADR records the rules spec 003 adds and why they look the way they do.

## Decision

### Licences: two tiers

`dependency-policy.json` (validated against `tools/supply-chain/dependency-policy.schema.json`) lists the allowed SPDX
licences in two tiers:

- **shipped**: npm packages without `dev: true` in `package-lock.json`, and NuGet packages used by any non-test project.
  Only permissive licences: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense.
- **tooling**: npm `dev` packages and NuGet packages reached only from test projects (`*.Tests` and the fixture
  projects). These may also use MPL-2.0, BlueOak-1.0.0, MIT-0, CC0-1.0, CC-BY-4.0 and Python-2.0.

Tooling gets the wider list because it never ships to a user: build, lint and test tools (lightningcss, caniuse-lite,
argparse, minimatch, `@csstools/*`, mdn-data) run on a developer machine or in CI, where file-level copyleft (MPL) or an
attribution licence (CC-BY) has no effect on what Helmstead distributes. Holding them to the shipped list would mean
about thirty exceptions that say nothing. Everything Helmstead ships stays on the strict list.

An `OR` expression passes when one side is allowed, an `AND` expression only when every part is. A missing, non-SPDX or
`UNLICENSED` licence fails, as does a NuGet package whose nuspec has only a `licenseUrl` or a licence file. The root
workspace package is skipped (choosing Helmstead's own licence is plan §11). Anything else needs a `licenseExceptions`
entry with the package, a version range and a reason.

The check is our own code (`tools/supply-chain/licenses.mjs`): it reads the lock file and the NuGet restore output
(`obj/project.assets.json` and each `.nuspec` in the global packages folder), needs no network and no third-party licence
checker, and runs in `node scripts/sdlc/verify.mjs` on every run.

### Vulnerabilities: high and critical, with expiring exceptions

The `dependency-policy` CI job runs `npm audit --json` and
`dotnet list apps/core/Helmstead.Core.slnx package --vulnerable --include-transitive --format json`. Every high or
critical advisory fails the job, in shipped and tooling dependencies alike: a compromised build tool can do as much harm
as a compromised runtime library. Moderate and low advisories do not fail it.

A `vulnerabilityExceptions` entry names the ecosystem, package and advisory ID, a reason and an `expires` date. It covers
only that advisory on that package, and only until the date. An expired entry fails the check even when the advisory is
gone, so stale exceptions get removed instead of piling up. The same checks run weekly on `main`
(`.github/workflows/supply-chain-weekly.yml`), because advisories appear without any change to the repository; a
failure opens or updates the issue "Weekly supply-chain check failed".

### Secrets: gitleaks, pinned and checksummed

Secrets are found by [gitleaks](https://github.com/gitleaks/gitleaks), with `.gitleaks.toml` extending its default rules.
A false positive goes in `.gitleaksignore` by fingerprint, one reviewed line each, never as an allowlist that could hide
more.

- A PreToolUse hook (`scripts/sdlc/hooks/scan-secrets.mjs`) scans what each `git commit` Claude runs would include (the
  index for a lone plain commit; for anything else, such as `-a`, paths, other commands before it, several commits, git
  aliases or quoting it cannot follow, every working-tree change through a temporary index) and blocks it on a finding.
  It prints rule, file and line, never the value. It also blocks when it cannot tell which repository the commit is in.
  It runs before the command, so content that an earlier part of the same command only creates is not there yet; the
  CI scan catches that.
- The `secret-scan` CI job scans every commit of a PR (`base..head`), so a secret added and removed again still fails:
  it is in the history and must be rotated. The weekly run scans the full history of `main`.

We use the gitleaks binary, not the gitleaks GitHub Action, which needs a paid licence for organisations. The release is
pinned in `tools/supply-chain/gitleaks.json`: the version, and per OS and architecture the URL of the official
`gitleaks/gitleaks` GitHub release asset and its SHA-256 from the release's checksums file. The same code
(`tools/supply-chain/gitleaks.mjs`) obtains it for the hook, CI and the weekly run. The pin also holds the SHA-256 of
the binary inside each archive (`binarySha256`), and nothing else is trusted: a gitleaks on the PATH or in the cache
(outside the repository, in the OS user cache folder) is used only when its hash is that value, so a stub that prints
the right version, or a cached file swapped with its neighbours, is ignored. Otherwise the archive is downloaded
(through `curl` when `HTTPS_PROXY` is set, since Node's `fetch` ignores proxies), verified against the pinned checksum
before anything is extracted or run, and the extracted binary is checked against `binarySha256`. A mismatch deletes it.
Findings exit with code 3; any other non-zero exit, including gitleaks' exit 1 after a partial scan, fails the check.
When gitleaks cannot be obtained or does not finish, the hook blocks the commit: it fails closed.

### No network in tests, and the live-test escape hatch

Plan §9 says tests make no live calls. That is now enforced at runtime on both sides:

- **Vitest**: `tools/testing/no-network.ts` is a setup file of every Vitest config and every Angular `test` target. It
  makes `net.Socket#connect`, `tls.connect`, `http(s).request`/`get`, global `fetch` and DNS lookups throw for any host
  that is not loopback (`127.0.0.0/8`, `::1`, `localhost`). `tools/workspace/no-network.spec.ts` fails a test target
  that does not load it, and a test runner it does not know.
- **.NET**: `apps/core/tests/Shared/NoNetwork.cs`, linked into every test project by
  `apps/core/tests/Directory.Build.props`, sets `HttpClient.DefaultProxy` in a module initializer to an unreachable
  loopback proxy that only loopback bypasses. Every `HttpClient` without its own proxy, including `IHttpClientFactory`
  clients, then fails fast; `WebApplicationFactory` (in memory) and fake message handlers still work. An ArchUnitNET rule
  (`Architecture/NetworkRules.cs`), applied to every test project of `Helmstead.Core.slnx`, forbids test code the
  ways around it: `Socket`, `TcpClient`, `UdpClient`, `WebProxy`, `IWebProxy`, `Dns`, `SmtpClient`, `Ping`,
  `QuicConnection`, setting `UseProxy` or `Proxy` on a handler, `SocketsHttpHandler.ConnectCallback`,
  `HttpClient.DefaultProxy`, `ClientWebSocketOptions.Proxy` and `WebRequest.Proxy`/`DefaultWebProxy`. Only
  `NoNetwork.cs` may use them.

Known limits: both guards work inside the test process, so a test that starts another program (`curl`) is not
stopped, and the .NET rule matches the listed APIs by name, so a library that wraps them is not seen. Both need
deliberate code and show up in review.

A test that really needs a live API is marked: a Vitest file named `*.live.spec.ts`, which every test include leaves
out, or an xUnit test with `[Trait("Category", "Live")]`, which every `dotnet test` run filters out
(`VSTestTestCaseFilter` in `apps/core/tests/Directory.Build.props`). Such tests run only with `HELMSTEAD_LIVE_TESTS=1`,
which also lifts the guards. No workflow sets that variable (a workspace test checks it), so live tests never run in CI.

### Every exception is a high-risk change

`dependency-policy.json`, `.gitleaks.toml`, `.gitleaksignore`, `tools/supply-chain/**`, the network guards
(`tools/testing/**`, `apps/core/tests/Shared/**`, `apps/core/tests/Directory.Build.props`) and
`scripts/sdlc/hooks/**` are in `scripts/sdlc/risk-paths.json`. So adding a licence or vulnerability exception, a
gitleaks fingerprint, or any change to the checks themselves, waits for the owner. The reason in each exception is what
the owner reviews.

## Consequences

- A new dependency with a disallowed licence, or a new high or critical advisory, turns `ci` red until it is fixed or
  excepted with a reason the owner accepts. Exceptions do not last: vulnerability exceptions expire.
- Claude cannot commit a secret through Bash or PowerShell, and any secret in a PR fails CI. Commits made outside the
  shell (for example the GitHub MCP `push_files` tool) and commits by people are caught by the CI scan, not the hook.
- Offline, a first commit blocks until gitleaks has been downloaded once. Installing gitleaks at the pinned version on
  the PATH avoids the download.
- Tests that need the network fail loudly, pointing to plan §9. Recorded fixtures or a loopback server are the way.
- Out of scope for now: Rust/Cargo (no `apps/shell` yet), moderate and low advisories, update bots, SBOMs and signing.
