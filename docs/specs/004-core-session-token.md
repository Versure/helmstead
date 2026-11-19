---
id: 004
title: Core session token and request checks
status: built            # draft | approved | built
type: feature            # feature | fix | chore | spike
plan-phase: 0            # docs/plan.md §8
branch: feat/004-core-session-token
---

# 004 — Core session token and request checks

## Problem
The core listens on loopback only, but any local process, and any website open in a browser on the machine, can call it: `GET /health` has no token (the known gap in ADR-002). Plan §3.3 requires a session token on every request before the core gets endpoints worth protecting. The shell that will create the token does not exist yet, so today nothing defines how the core receives a token, how it rejects a request, or how the web app sends one.

## Outcome
The core does not start without a session token and answers 401 to every request that does not carry it, `/health` included. Requests with a foreign `Host` or any `Origin` are refused before the token is looked at. The web app can send the token and shows a distinct "core refused this session" state. Development keeps working with one command per app: `npx nx serve core` makes a fresh random token per run and the web dev server's proxy adds it, so the browser never holds a token in development. The shell spec (005) only has to create a token and hand it over.

## Acceptance criteria
Each one is testable and names how it is checked.

### Core: receiving the token
1. Given the core starts, then it reads the session token from the environment variable `HELMSTEAD_SESSION_TOKEN` and from nowhere else: not from `appsettings*.json`, command-line arguments or any other configuration source. — *check:* xUnit tests that a token supplied through each other source is ignored and startup fails as in criterion 2.
2. Given `HELMSTEAD_SESSION_TOKEN` is missing, empty, or shorter than 43 characters (32 random bytes as base64url), or contains characters outside `A–Z a–z 0–9 - _`, when the core starts, then startup fails with a message that names the variable and the rule and never contains the value. — *check:* xUnit tests per case, asserting the message does not contain the supplied value.
3. Given the core has read the token, then it removes `HELMSTEAD_SESSION_TOKEN` from its own process environment, so child processes started later (agents, MCP servers) do not inherit it. — *check:* xUnit test.

### Core: checking requests
4. Given any request, when it has no `Authorization` header, a scheme other than `Bearer`, or a token that differs from the session token, then the response is `401` with `WWW-Authenticate: Bearer` and an `application/problem+json` body that does not say which of those cases applied. The comparison is constant-time (`CryptographicOperations.FixedTimeEquals`). — *check:* xUnit tests through `WebApplicationFactory` for each case, and a unit test of the comparer for equal, different and different-length input.
5. Given a request with the correct token as `Authorization: Bearer <token>`, then it reaches the endpoint; `GET /health` returns the same body as before. — *check:* the existing `HealthEndpointTests`, updated to send the token.
6. Given a path that does not exist, when it is requested without a valid token, then the response is `401`, not `404`. — *check:* xUnit test.
7. Given the token is sent any other way (query string, cookie, another header), then the request is treated as having no token. — *check:* xUnit tests.
8. Given a request whose `Host` header is not a loopback IP literal (`127.0.0.0/8`, `[::1]`) with a port the core is listening on, then the response is `403`, with or without a valid token. `localhost` and other names are refused, as in `LoopbackBinding`. — *check:* xUnit tests for a foreign name, `localhost`, a loopback literal with the wrong port, and the correct host.
9. Given a request with an `Origin` header that is not in the core's allowed-origins list, then the response is `403`, with or without a valid token, including `OPTIONS` preflights, and no response ever carries an `Access-Control-*` header. The list is a constant in code and is empty in this spec; it cannot be set through configuration or the environment. — *check:* xUnit tests for a web origin, `null`, a preflight, and a request without `Origin`.
10. Given the checks of criteria 4, 8 and 9, then they run before routing for every request, in the order host, origin, token, and no endpoint can opt out: no `AllowAnonymous`, no path allow-list. — *check:* an xUnit test that walks every endpoint in the app's `EndpointDataSource` and asserts `401` without a token, and an architecture rule in `Architecture/` that fails on any use of `AllowAnonymous`/`IAllowAnonymous` in `Helmstead.*` assemblies, with a negative fixture.
11. Given the core's logs at any level, then neither the session token nor a token presented by a client appears in them, at startup or when a request is rejected. A rejected request logs one warning with the reason (host, origin or token) and the remote port, nothing from the headers. — *check:* xUnit test with a capturing logger that starts the app, sends accepted and rejected requests and searches all output for both token values.
12. Given the checks live in `Helmstead.Core.Api/Shared/` (not in a slice), then the architecture tests still pass and no slice references them directly. — *check:* existing architecture tests.

### Contract
13. Given `libs/api-contracts/openapi.json`, then it declares an HTTP bearer security scheme applied to every operation and a `401` problem response on every operation, and the generated types are regenerated and committed. — *check:* `npx nx run api-contracts:check`, and an assertion in `libs/api-contracts/src/contract.spec.ts` that every operation has the security requirement and a `401` response.

### Web app
14. Given `@helmstead/system-data-access`, then it exposes a `CORE_SESSION_TOKEN` injection token (`string | null`, default `null`) next to `CORE_BASE_URL`, and `provideCoreHttp()` registers an interceptor that adds `Authorization: Bearer <token>` when the token is set and the request URL starts with `CORE_BASE_URL` followed by `/`, with a non-empty `CORE_BASE_URL`. A request to any other URL never gets the header. With the defaults (empty base URL, `null` token) no header is added. — *check:* unit tests with `HttpTestingController` for a core URL, another origin, a URL that only shares the prefix (`http://127.0.0.1:51080` against base `http://127.0.0.1:5108`), and the defaults.
15. Given the core answers `401`, then `SystemStatusService.status` is `{ state: 'rejected' }`, a new member of `SystemStatus` in `@helmstead/system-model`. Any other failure, `403` included, stays `unreachable`. — *check:* unit tests of the service.
16. Given the status is `rejected`, then the status badge shows the danger tone with the label `Core refused this session`, the title `Restart Helmstead to start a new session`, and the Retry button. The state is announced through the existing `role="status"` region and is not shown by colour alone. — *check:* component test, and a screenshot of the badge in both themes in the PR.

### Development
17. Given `npx nx serve core`, then a launcher (`tools/dev/serve-core.mjs`) generates 32 random bytes with `crypto.randomBytes`, base64url-encodes them, writes the token to `.helmstead/dev-session-token` in the repo root, created with mode `0600` and overwritten on every start, starts the core with `HELMSTEAD_SESSION_TOKEN` set, and deletes the file when the core exits. The token is never printed. `.helmstead/` is in `.gitignore`. — *check:* unit tests of the launcher's token and file handling (with a stub in place of `dotnet`), a test that the launcher's output does not contain the token, and a workspace test that `.helmstead/` is ignored by git.
18. Given `npx nx serve web`, then the dev proxy (now a `.mjs` config) reads `.helmstead/dev-session-token` on each request, sets `Authorization: Bearer <token>`, sets `Host` to the core's address and removes `Origin`, so the browser never receives the token. When the file is missing, the proxy answers `502` and logs once that `npx nx serve core` must be running. The proxy forwards only to `http://127.0.0.1:5108`. — *check:* unit tests of the proxy's request rewriting with a temporary token file and without one.
19. Given both dev servers are running, then the badge shows `Connected`; after the core is restarted, Retry shows `Connected` again without restarting the web dev server; and `curl http://127.0.0.1:5108/health` without a header returns `401`. — *check:* run once by the build, with the badge screenshot and the `curl` output (status line only) in the PR.
20. Given the production build of `apps/web`, then it contains neither the proxy nor any code that reads the token file. — *check:* a workspace test that nothing under `apps/web/src` or `libs/` imports from `tools/dev` or references `dev-session-token`.

### Documentation
21. Given `docs/adr/`, then `006-session-token-and-request-checks.md` records: the token's source, format and lifetime; the bearer header as the only transport; the host and origin checks and their order; that no endpoint is exempt; the development token file and its limits; and what spec 005 adds (the shell creates the token, the allowed origin of the webview, port 0). ADR-002's "known gap" on `/health` is marked closed with a link to ADR-006. `001` stays reserved for Tauri versus Electron. — *check:* spec-reviewer.
22. Given `CLAUDE.md`, then the Commands section says that the core needs a session token, that `npx nx serve core` provides one, and how a .NET test sends it. — *check:* spec-reviewer.

## Out of scope
- `apps/shell`, starting the core as a sidecar, and ADR-001 (Tauri, decided by the owner; written in spec 005).
- A random port: the core binding to `127.0.0.1:0` and announcing the port on stdout (spec 005). Development stays on `5108`.
- Any allowed origin and any CORS header. Spec 005 adds exactly the Tauri webview's origin.
- Setting `CORE_BASE_URL` and `CORE_SESSION_TOKEN` at runtime in the shipped app (spec 005).
- Cargo in the supply-chain policy (spec 005).
- Token transport for SSE and WebSocket. Decided when the first streaming endpoint is specified.
- Rotating the token within a run, rate limiting and lock-out.
- The end-to-end smoke test of plan §9 (arrives with the shell).

## Decisions from the interview
- Tauri or Electron → Tauri v2, decided by the owner without a separate spike. ADR-001 is written in the shell spec; the working sidecar on three OSes in CI is the evidence. Keychain integration is proven in the SQLite/keychain spec, and ADR-001 is revisited if that fails.
- How to cut the work → two specs. 004: the core requires the token and the web app sends it, testable without a shell. 005: the Tauri shell, sidecar, port and token hand-over, and Cargo in the dependency policy.
- How port and token reach the core → the token in an environment variable; the core binds port 0 itself and reports the port on stdout (the port part is spec 005). Why: no token in the process list, no race for the port.
- Core without the shell → the token is always required. No mode switches the check off; `nx serve core` makes a random token per run.
- `/health` → no exception. The shell waits for the core by calling `/health` with the token.
- Development token → a file in an ignored folder in the repo, readable by the user only, overwritten on each start; the dev proxy adds the header and the browser never sees the token.
- Host and Origin → both are checked, as a second layer should the token leak. The allowed-origins list is empty in this spec.
- A 401 in the UI → its own state in the status badge, with the advice to restart the app.

Defaults chosen while writing (not asked, sensible and reversible):
- Transport → `Authorization: Bearer`, nothing else.
- Variable name → `HELMSTEAD_SESSION_TOKEN`; minimum 32 random bytes, base64url.
- Status codes → `401` for the token, `403` for host and origin, checked in the order host, origin, token.
- The allowed-origins list is a constant in code, so nothing at runtime can widen it.
- No new packages: a small middleware instead of an authentication library.

## Risk forecast
High risk. The owner will want to look at:
- **Security** — the request checks in `Helmstead.Core.Api/Shared/` (order, constant-time comparison, that nothing runs before them), how the token is read and removed from the environment, what is logged on a rejection, the dev launcher and proxy in `tools/dev/` (file mode, lifetime, that the proxy only targets `127.0.0.1:5108`), and the web interceptor's rule for which URLs get the header.
- **Architecture** — new code under `Shared/`, the regenerated API contract (security scheme and `401` on every operation), the new architecture rule and its fixture, ADR-006 and the edit to ADR-002, and `project.json` changes for the `serve` targets.
- **Pipeline** — `CLAUDE.md` and `.gitignore`. No new dependencies are expected; if the build needs one, it says so in the PR.
- **Data** — none.

## Notes for the build
- Plan §3.3 and §10 rule 6; ADR-002 "Known gap"; ADR-004 on `CORE_BASE_URL`; ADR-005 on test tokens.
- Never write a literal token in a test or fixture: build it at runtime (`RandomNumberGenerator`, `crypto.randomBytes`), or the secret scan blocks the commit.
- `WebApplicationFactory` uses `localhost` as its default host; set `BaseAddress` to a loopback literal. `TestServer` has no bound port, so decide the port part of criterion 8 against `IServerAddressesFeature` and cover the real-port case with a Kestrel-backed test on `127.0.0.1:0` (loopback is allowed by the network guard).
- The token must be available before `WebApplication.CreateBuilder` snapshots environment variables into configuration, or it ends up in `IConfiguration`; read and remove it first, and test that `IConfiguration` does not contain it.
- The contract generator builds the OpenAPI document at build time; check that it does not need a running core or a token.
- The dev proxy moves from `apps/web/proxy.conf.json` to a `.mjs` file; update the `serve` target and ADR-004's sentence about the proxy.
- On Windows, mode `0600` is not enforced by Node; the file is in the user's own checkout. Record that limit in ADR-006.
- Badge: Helm design system StatusPill, as in spec 002 (link in that spec's notes). No new mockup.

## Open questions
