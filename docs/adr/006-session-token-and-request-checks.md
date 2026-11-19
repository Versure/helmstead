# 006 — Session token and request checks

- Status: accepted
- Date: 2026-11-19
- Spec: [004 — Core session token and request checks](../specs/004-core-session-token.md)

## Context

The core listens on loopback only ([ADR 002](002-module-boundaries.md)), but loopback is shared by every process on the
machine and by every web page open in a browser there. Plan §3.3 requires a session token on every request, so that
neither another local process nor a website can use the core. The shell that will create the token does not exist yet
(spec 005), so this ADR fixes how the core receives the token, how it checks requests, and how development works
without a shell.

## Decision

### The token

- **Source.** The environment variable `HELMSTEAD_SESSION_TOKEN`, and nothing else: not `appsettings*.json`, not the
  command line, not any other configuration source. An environment variable keeps the token out of the process list
  (command-line arguments are visible to every user on most systems).
- **Format.** At least 43 characters of base64url (`A–Z a–z 0–9 - _`), which is 32 random bytes without padding.
  Anything else stops startup with a message that names the variable and the rule and never contains the value.
- **Reading.** `SessionToken.ForThisProcess()` is the first statement of `Program.cs`. It reads the variable and removes
  it from the process environment before `WebApplication.CreateBuilder` copies the environment into `IConfiguration`.
  So the token is not in the configuration, and child processes started with `Process.Start` do not inherit it.
  On Linux and macOS this removes it only from .NET's copy of the environment: the native environment block
  (`/proc/<pid>/environ`) still holds it, and a child started by native code (a PTY library, libgit2) would inherit it.
  So the code that starts agents and MCP servers must build each child's environment explicitly, without
  `HELMSTEAD_SESSION_TOKEN`, and test that.
- **Lifetime.** One run of the core. A restart means a new token; there is no rotation within a run.
- **OpenAPI generation.** At build time the OpenAPI generator (`GetDocument.Insider`) builds the app but never starts the
  server, and has no token. Only in that case the core makes up an unguessable token instead of failing, so the
  contract can be generated without a running core or a token, and the checks stay registered.

### Transport

`Authorization: Bearer <token>` is the only way to send it. A token in the query string, a cookie or any other header
counts as no token. The scheme is case-insensitive; exactly one `Authorization` header is accepted. The comparison is
`CryptographicOperations.FixedTimeEquals` over the UTF-8 bytes. Token transport for SSE and WebSocket is decided when
the first streaming endpoint is specified.

### The checks, in order

`Shared/Session/SessionChecks.cs` registers one middleware as the **first** startup filter, so it wraps the whole
pipeline: it runs before ASP.NET Core's own host filtering, before routing and before every endpoint.

1. **Host** — the `Host` header must be a loopback IP literal (`127.0.0.0/8` in dotted-quad form, or `[::1]`) with a port
   the server reports in `IServerAddressesFeature`, else `403`. Names such as `localhost` are refused, as in
   `LoopbackBinding`. This stops DNS rebinding: a page on `attacker.example` that resolves to `127.0.0.1` still sends
   its own name.
2. **Origin** — a request with an `Origin` header (preflights included) is refused with `403` unless the origin is in
   `SessionChecks.AllowedOrigins`. That list is a constant in code and empty; nothing at runtime can widen it. The core
   sends no `Access-Control-*` header at all.
3. **Token** — else `401` with `WWW-Authenticate: Bearer` and the same `application/problem+json` body (schema `SessionRefusal` in the
   contract) whatever was wrong (missing, other scheme, wrong token).

Host and origin come first because they are a second layer should the token leak: a leaked token still cannot be used
from a web page. A path that does not exist answers `401`, not `404`, so the API cannot be mapped without the token.

The checks hold only while they are the outermost startup filter (a test pins that) and only for the Kestrel
listener of the app. Any other listener the core opens later, such as an HTTP server for the MCP host (plan §4.5), must
apply the same checks.

**No endpoint is exempt**, `/health` included: the shell waits for the core by calling `/health` with the token. There
is no `AllowAnonymous` and no path allow-list. An architecture rule ("No endpoint allows anonymous access") fails on any
use of `AllowAnonymous`/`IAllowAnonymous` in a `Helmstead.*` assembly, and a test walks every endpoint of the app and
expects `401` without the token.

`AllowedHosts` (ASP.NET Core host filtering) is narrowed to `127.0.0.1;[::1]`. It runs after these checks and only adds
a `400` for another address in `127.0.0.0/8`, which the core never listens on.

### Logging

A refused request logs one warning: the check that failed (`host`, `origin` or `token`) and the remote port. Nothing
from the headers. The token is never logged. ASP.NET Core's "Request starting" message logs the full URL, so a token a
client wrongly put in the query string would reach the log; the checks add filter rules after every other rule that
keep `Microsoft.AspNetCore.Hosting.Diagnostics` at `Warning`, for every provider, whatever the log settings say.

### The web app

`@helmstead/system-data-access` has `CORE_SESSION_TOKEN` (`string | null`, `null` by default) next to `CORE_BASE_URL`.
The interceptor in `provideCoreHttp()` adds the header only when a token is set, `CORE_BASE_URL` is not empty, and the
URL starts with the base URL followed by `/`. A relative URL, another origin, or a port or host that merely shares the
prefix never gets it. A `401` from the core shows as "Core refused this session" (restart advice in the tooltip); a
`403` stays "Core unreachable".

### Development

`npx nx serve core` runs `tools/dev/serve-core.mjs`: it makes 32 random bytes per run, writes them base64url-encoded to
`.helmstead/dev-session-token` (ignored by git; the folder `0700`, the file `0600`, recreated on every start), starts
`dotnet run` with the variable set, and deletes the file when the core exits. The core runs in its own process group so
that stopping the launcher stops the core. The token is never printed.

`npx nx serve web` uses `apps/web/proxy.conf.mjs`. It first refuses a cross-site request with `403` (an `Origin`
other than the dev server's own, or a `Sec-Fetch-Site` other than `same-origin` or `none`), because it removes `Origin`
and so takes the core's origin check away. Then, on every request, it reads the token file, sets
`Authorization: Bearer <token>`, sets `Host` to `127.0.0.1:5108` and removes `Origin`, and forwards only to
`http://127.0.0.1:5108`. Without the file it answers `502` and says once that `npx nx serve core` must run. The browser
never holds the token, and the production build contains neither the proxy nor anything that reads the file.

Limits of the development setup:

- Any process running as the same user can read the token file while the core runs. That is the same trust boundary as
  the user's own checkout, and the file only opens a development core.
- On Windows, Node cannot set mode `0600`; the file has the permissions of the user's checkout.
- The web dev server itself is reachable on `localhost:4200` and forwards with the token. It is a development server on
  the developer's machine; the shipped app has no proxy.

### What spec 005 adds

- The Tauri shell creates the token (32 random bytes) and starts the core with `HELMSTEAD_SESSION_TOKEN` set.
- The core binds `127.0.0.1:0` and announces the port on stdout; the host check already uses the port the server
  actually listens on.
- `AllowedOrigins` gets exactly the webview's origin, with the CORS headers that requires.
- The shell sets `CORE_BASE_URL` and `CORE_SESSION_TOKEN` in the webview at startup.

## Consequences

- Every new endpoint is protected without doing anything, and cannot opt out without failing the build.
- A .NET test that starts the core goes through `CoreApp` (`apps/core/tests/Helmstead.Core.Tests/Api/CoreApp.cs`), which
  sets a fresh token for that start and offers `CreateAuthorizedClient()`. Tests never contain a literal token.
- `dotnet run` without the launcher stops at once; `npx nx serve core` is the way to run the core in development.
- The checks are a small middleware, not an authentication library: no new dependency, nothing to configure.
