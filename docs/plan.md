# Helmstead — Build Plan

*Your home port for AI-assisted development.*

> **Status:** initial plan, version 0.1
> **Audience:** contributors and AI coding agents (such as Claude Code or Codex) that implement most of the work.
> **Name:** Helmstead combines *helm* (where a ship is steered) and *stead* (a place, a home base).

---

## 1. Purpose

Helmstead is an open-source, local-first desktop application that acts as a **control center for AI-assisted software development**. Its goal is to reduce context switching. Agent sessions, code hosting (GitLab/GitHub), issue tracking (YouTrack/Jira), AI configuration and costs live in one environment, instead of being spread across AI desktop apps, web UIs and terminals.

The system also learns from how it is used. It remembers decisions, conventions and preferences across sessions, and it proposes improvements such as new skills or instructions.

### 1.1 Core features

1. **AI-tool agnostic.** Works with Claude Code and Codex. Other agent harnesses and model providers can be added later.
2. **Local models.** Manages models via Ollama (and other OpenAI-compatible runtimes). They are used for internal tasks and, optionally, as a backend for agents.
3. **Memory and learning.** An explicit memory layer plus RAG, persistent across sessions.
4. **Work overview.** Projects, merge/pull requests with their status, sprints and issues from GitLab, GitHub, YouTrack and Jira.
5. **Configuration management.** MCP servers, skills and instructions, managed centrally and generated per tool.
6. **Cost and resource insight.** API costs, estimated subscription usage, local usage and machine load.
7. **Access to AI vendor features.** Where no API exists (for example Claude Design or Cowork): launchers and deep links.

### 1.2 Explicitly out of scope (for now)

- A custom agent loop or harness. The Agent Client Protocol (ACP) and existing harnesses already cover this.
- Driving Claude Design, Cowork or other app surfaces that have no public API.
- Reusing subscription logins (for example Claude Pro/Max OAuth) inside this application. The official CLIs handle their own authentication.
- Multi-user, server-based or cloud-hosted operation. This is a local, single-user app.
- Mobile clients.

---

## 2. Design principles

These principles apply to every design and implementation decision. Any deviation must be recorded in an ADR (see §10).

1. **Harness ≠ model.** Claude Code and Codex are harnesses (loop, tools, permissions, context). The model underneath is an interchangeable provider. Keep these two concepts strictly separate in code and UI.
2. **Deterministic where possible, LLM where necessary.** Dashboards and overviews call the platforms' REST/GraphQL APIs directly. MCP and LLMs are only for what an agent needs to *do*. No LLM in the path of a list view.
3. **Single source of truth for configuration.** Instructions, skills and MCP configuration live in the app. Tool-specific files (CLAUDE.md, `.mcp.json`, Codex `config.toml`, AGENTS.md) are generated, and the user sees a diff before anything is written.
4. **Local first.** Data, memory and embeddings stay on the machine. Cloud models are only used where the user explicitly configures them.
5. **Lazy and frugal.** Connectors, MCP servers, agents and models only start when needed. Background work runs while the machine is idle where possible.
6. **The human stays in control of learning.** Memory is visible and editable. Generated skills or instructions are proposals, never silent changes.
7. **Standards over custom protocols.** ACP for agents, MCP for tools, SKILL.md for skills, AGENTS.md for instructions, and OpenAI-compatible APIs for local models.
8. **Cross-platform and privacy-respecting.** Windows, macOS and Linux are first-class targets. No telemetry unless the user explicitly opts in.

---

## 3. Architecture

### 3.1 Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Desktop shell (Tauri v2)                                    │
│  └─ Angular frontend (UI, dashboards, sessions, config)      │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTP + WebSocket/SSE (localhost, token auth)
┌───────────────▼──────────────────────────────────────────────┐
│  Core service (.NET, as a Tauri sidecar)                     │
│                                                              │
│  ┌──────────────┐ ┌───────────────┐ ┌──────────────────────┐ │
│  │ Agent runtime│ │ Connectors    │ │ Config registry      │ │
│  │ (ACP client) │ │ GitLab/GitHub │ │ MCP/skills/instruct. │ │
│  │              │ │ YouTrack/Jira │ │ + generators per tool│ │
│  └──────┬───────┘ └──────┬────────┘ └──────────────────────┘ │
│  ┌──────▼───────┐ ┌──────▼────────┐ ┌──────────────────────┐ │
│  │ Provider     │ │ Work item     │ │ Memory & RAG         │ │
│  │ registry     │ │ model + cache │ │ extraction, retrieval│ │
│  │ (cloud/Ollama│ │               │ │                      │ │
│  └──────────────┘ └───────────────┘ └──────────────────────┘ │
│  ┌──────────────┐ ┌───────────────┐ ┌──────────────────────┐ │
│  │ MCP host     │ │ Usage & cost  │ │ Scheduler (idle/bg)  │ │
│  │ (shared HTTP │ │ + resources   │ │                      │ │
│  │  servers)    │ │               │ │                      │ │
│  └──────────────┘ └───────────────┘ └──────────────────────┘ │
│                                                              │
│  Storage: SQLite (+ sqlite-vec), files in the app data dir   │
│  Secrets: OS keychain (Credential Manager/Keychain/libsecret)│
└──────────────────────────────────────────────────────────────┘
        │                 │                     │
   ACP (stdio)      HTTPS APIs             HTTP (localhost)
        │                 │                     │
 Claude Code ACP    GitLab, GitHub,        Ollama / LM Studio /
 Codex ACP          YouTrack, Jira         other OpenAI-compat.
```

### 3.2 Technology choices

| Component | Choice | Rationale |
|---|---|---|
| Monorepo | Nx | Frontend, tooling and project graph in one workspace. |
| Desktop shell | Tauri v2 | Uses the OS webview, so the footprint is low (tens of MB idle). Supports sidecars. Alternative: Electron (heavier, larger ecosystem). To be recorded in ADR-001. |
| Frontend | Angular (current version, standalone components, signals) | Mature, strongly typed, well suited for dashboard-heavy UIs. |
| Core service | .NET (current LTS), ASP.NET Core minimal APIs | Strong for long-running background services, cross-platform. Started as a Tauri sidecar. |
| Storage | SQLite + sqlite-vec | Serverless, more than enough for a single user, vector search in the same database. |
| Data access | EF Core for domain data; raw SQL for vector queries | Pragmatic. |
| Frontend ↔ core | REST + SSE/WebSocket for streaming | Agent output and model download progress are streamed. |
| Agents | ACP (JSON-RPC over stdio) | One interface for Claude Code and Codex. |
| Local models | Ollama native API + OpenAI-compatible endpoint | Management via the native API, inference via the OpenAI-compatible API. |
| Secrets | OS keychain | No tokens in SQLite or config files. |

> **Verify at the start** (these change quickly):
> - Current package names and versions of the ACP adapters for Claude Code and Codex, and whether a usable .NET ACP library exists (otherwise a custom JSON-RPC client, see §4.3).
> - Which Ollama version provides Anthropic Messages API compatibility (needed to run Claude Code on a local model).
> - How Codex reads provider configuration (`config.toml`, `model_provider`, `--oss`).
> - The current endpoints of the Anthropic Usage & Cost (Admin) API and the OpenAI Usage API.
> - Which Claude app surfaces (Design, Cowork and similar) now have an API or a deep-link scheme.

### 3.3 Core service communication and security

- The core service listens only on `127.0.0.1`, on a random port chosen at startup.
- The shell generates a session token per run and passes it to the sidecar and the frontend. Every request requires that token. This prevents other local processes or websites from reaching the service.
- CORS is not opened for arbitrary origins.

---

## 4. Components

### 4.1 Provider registry

Manages where models come from.

```csharp
public enum ProviderKind { Anthropic, OpenAI, OpenAICompatible, Ollama }

public sealed record ModelProvider(
    Guid Id,
    string Name,
    ProviderKind Kind,
    Uri Endpoint,
    string? SecretRef,          // reference to a keychain item, never the value itself
    bool IsLocal);

public sealed record ModelInfo(
    Guid ProviderId,
    string ModelId,
    int ContextWindow,
    int? ConfiguredContext,     // for Ollama: num_ctx
    ModelCapabilities Capabilities,
    CostModel? Cost);           // null = local, no per-token cost

[Flags]
public enum ModelCapabilities { Chat = 1, ToolCalling = 2, Vision = 4, Embeddings = 8 }

public sealed record CostModel(decimal InputPerMTok, decimal OutputPerMTok, decimal? CachedInputPerMTok);
```

**Ollama management** (via the native API):

| Function | Endpoint |
|---|---|
| Installed models | `GET /api/tags` |
| Download a model (with streaming progress) | `POST /api/pull` |
| Loaded models and memory usage | `GET /api/ps` |
| Metadata (context length, parameters, template) | `POST /api/show` |
| Delete | `DELETE /api/delete` |

Points of attention:
- **Always set `num_ctx` explicitly** and show it in the UI. Ollama's default context is too small for agentic use, so system prompts and tool definitions get truncated silently.
- Make `keep_alive` configurable per model, with a sensible default.
- Detect availability: is Ollama running, which version, which capabilities.

**Routing** (simple rules, first match wins):

```csharp
public sealed record RoutingRule(
    int Priority,
    TaskKind Task,              // Embedding, MemoryExtraction, Summarization, Classification, AgentBackend
    Guid? ProjectId,            // null = all projects
    Guid ProviderId,
    string ModelId,
    bool CloudForbidden);       // e.g. for confidential client projects
```

By default, embeddings, memory extraction and summarization run locally (if a local model is available). Otherwise they are disabled, or the app asks permission to use a cloud model.

### 4.2 Config registry

The single source of truth for:

- **MCP servers.** Name, transport (stdio/HTTP), command/URL, environment variables (secrets via keychain references), scope (global or per project) and whether to host it as a shared server.
- **Skills.** Folders containing SKILL.md and related files, global or per project.
- **Instructions.** Layered: global → per organization or client → per project.

**Generators** per harness translate this into the files that harness reads:

| Harness | Generates (verify against current docs) |
|---|---|
| Claude Code | `CLAUDE.md`, `.mcp.json`, `.claude/skills/…`, `.claude/settings.json` |
| Codex | `AGENTS.md`, `~/.codex/config.toml` (MCP, providers), skills folder |

Requirements:
- **Import** existing configuration (an existing `.mcp.json`, CLAUDE.md, `config.toml`) so users do not have to start from scratch.
- **Diff preview** before every write, and never overwrite silently.
- **Drift detection.** If a generated file was changed outside the app, the app reports it and offers to import the change.
- Generated files carry a marker (comment line or header) indicating they are managed by the app, where the format allows it.

### 4.3 Agent runtime

- Starts harnesses via their ACP adapter as a subprocess and communicates via JSON-RPC over stdio.
- If no suitable .NET ACP library exists: build a thin client (`IAcpClient`) with only the methods needed (start session, prompt, streamed updates, permission requests, cancel). Keep it isolated so it can be replaced later.
- A **session** is linked to a project (working directory) and optionally to a work item (§4.4).
- **Permission requests** from the agent (write a file, run a command) are shown in the UI and handled by the user.
- **Transcripts** are stored (for memory extraction and usage tracking).
- **Context injection** at session start: relevant memory notes (§4.6) and the linked work item's context.
- A configurable limit on the number of concurrent sessions (default 3).

```csharp
public sealed record AgentSession(
    Guid Id,
    HarnessKind Harness,        // ClaudeCode, Codex
    Guid ProjectId,
    string WorkingDirectory,
    Guid? ProviderId,           // null = the harness's default provider
    string? ModelId,
    WorkItemRef? LinkedWorkItem,
    SessionState State,
    DateTimeOffset StartedAt);
```

### 4.4 Connectors and work item model

Every connector implements the same interfaces. Internally, the app only works with the normalized model.

```csharp
public interface ISourceConnector
{
    SourceKind Kind { get; }                     // GitLab, GitHub, YouTrack, Jira
    Task<ConnectionTestResult> TestAsync(CancellationToken ct);
    Task<IReadOnlyList<Project>> GetProjectsAsync(CancellationToken ct);
}

public interface IWorkItemSource : ISourceConnector
{
    Task<IReadOnlyList<WorkItem>> GetWorkItemsAsync(WorkItemQuery query, CancellationToken ct);
    Task<IReadOnlyList<Iteration>> GetIterationsAsync(string projectExternalId, CancellationToken ct);
}

public interface IChangeRequestSource : ISourceConnector
{
    Task<IReadOnlyList<ChangeRequest>> GetChangeRequestsAsync(ChangeRequestQuery query, CancellationToken ct);
}
```

**Normalized model** (first draft, refined in phase 2):

```csharp
public sealed record WorkItemRef(SourceKind Source, string ConnectionId, string ExternalId);

public sealed record WorkItem(
    WorkItemRef Ref,
    string Key,                 // "ABC-123", "#45", "&10"
    string Title,
    WorkItemType Type,          // Epic, Story, Task, Bug, Other
    string RawType,             // original type name from the source
    WorkItemStatus Status,      // normalized: Open, InProgress, InReview, Done, Cancelled
    string RawStatus,
    string? Assignee,
    Guid? IterationId,
    WorkItemRef? Parent,
    IReadOnlyList<string> Labels,
    IReadOnlyDictionary<string, string> CustomFields,  // YouTrack/Jira custom fields, not normalized
    Uri WebUrl,
    DateTimeOffset UpdatedAt);

public sealed record ChangeRequest(               // MR (GitLab) or PR (GitHub)
    WorkItemRef Ref,
    string Title,
    string SourceBranch,
    string TargetBranch,
    ChangeRequestState State,                     // Draft, Open, Merged, Closed
    PipelineStatus? Pipeline,                     // Pending, Running, Success, Failed, None
    ReviewStatus Review,                          // NoReviewers, Pending, ChangesRequested, Approved
    int UnresolvedThreads,
    IReadOnlyList<WorkItemRef> LinkedWorkItems,
    Uri WebUrl,
    DateTimeOffset UpdatedAt);

public sealed record Iteration(                   // sprint (Jira/YouTrack), iteration/milestone (GitLab/GitHub)
    Guid Id, WorkItemRef Ref, string Name,
    DateOnly? Start, DateOnly? End, bool IsCurrent);
```

**Mapping table per source** (first version, to be refined):

| Concept | GitLab | GitHub | YouTrack | Jira |
|---|---|---|---|---|
| Project | Project / Group | Repository / Project v2 | Project | Project |
| Epic | Epic | Issue with parent or type | Issue (type Epic) | Epic (issue type) |
| Work item | Issue / work item | Issue | Issue | Issue |
| Iteration | Iteration / Milestone | Project v2 iteration field / Milestone | Sprint (Agile board) | Sprint (Agile API) |
| Change request | Merge request | Pull request | n/a | n/a (via dev panel link) |

Status mapping is **configurable per connection**, because workflows differ between teams. The app proposes a default mapping and the user adjusts it.

**Synchronization:**
- A local cache in SQLite. The UI always reads from the cache.
- Updates via polling with a modest interval (default 2–5 minutes, configurable per source) and manual refresh.
- Webhooks come later, because they require a reachable endpoint. That is hard to provide locally and not needed for a single user.
- Respect rate limits. Use `If-None-Match`/ETags and `updated_after` filters where the API supports them.

**Authentication:** personal access tokens (stored in the keychain) for the first version. OAuth later, per platform.

### 4.5 MCP host

- Frequently used MCP servers can be run **once, shared**, as an HTTP server (stdio servers via a stdio→HTTP bridge), so that not every agent session spawns its own set of processes.
- The generators (§4.2) point harnesses at those shared endpoints when shared hosting is enabled.
- Status per server: running or not, PID, memory usage, last error and a restart button.

### 4.6 Memory and RAG

Two separate mechanisms:

**A. Memory (structured, editable)**

- After an agent session ends (or when the machine is idle), a local model extracts **durable facts** from the transcript: decisions, conventions, preferences and project facts.
- Each fact becomes a **memory note** with a scope (global, organization or project), source (session ID), date and status (`proposed` or `confirmed`).
- New notes start as `proposed`. The user confirms, edits or rejects them in an inbox.
- At session start, relevant confirmed notes are injected, based on project scope and retrieval.

```csharp
public sealed record MemoryNote(
    Guid Id,
    MemoryScope Scope,          // Global, Organization, Project
    Guid? ScopeId,
    string Content,
    MemoryNoteKind Kind,        // Decision, Convention, Preference, Fact
    MemoryNoteStatus Status,    // Proposed, Confirmed, Rejected, Superseded
    Guid? SourceSessionId,
    Guid? SupersedesId,
    DateTimeOffset CreatedAt);
```

**B. RAG (documents and code)**

- Indexes project documentation (`docs/`, READMEs, ADRs) and optionally source code.
- Chunks by structure (markdown headings, code symbols) instead of a fixed length.
- Embeddings via a local embedding model (for example `nomic-embed-text` or `bge-m3`), stored in sqlite-vec.
- Incremental reindexing based on file hashes, scheduled while the machine is idle.
- Available to agents through the app's **own MCP server** (`helmstead-memory`) with tools such as `search_docs`, `search_memory` and `get_work_item`. Any harness can use the memory without harness-specific integration.

**C. Learning from patterns (later phase)**

- The app detects recurring patterns across sessions, such as the same review instructions or the same corrections over and over.
- It proposes turning those into a skill or an instruction. The proposal goes to the inbox with its rationale (which sessions, which pattern).
- Changes to instructions or skills are never applied automatically.

### 4.7 Usage, costs and resources

**Costs:**
- **API usage:** fetched via the Anthropic Usage & Cost API (Admin key) and the OpenAI Usage API.
- **Subscription usage:** tokens read from the harnesses' local session logs (such as Claude Code's JSONL files), showing the equivalent API amount, clearly marked as an **estimate**.
- **Local usage:** count tokens and show what the same usage would have cost on a chosen cloud model.
- Views per day, week and month, per project, per harness and per model.

**Resources:**
- Loaded Ollama models and their memory (`/api/ps`).
- Active agent sessions and MCP processes with their memory usage.
- A warning when the estimated load approaches available RAM or VRAM.

### 4.8 Launchers for app surfaces

For Claude Design, Cowork and similar surfaces without an API: a configurable list of launchers (URLs, deep links or opening the desktop app), optionally with project context copied to the clipboard. This stays a deliberately limited component until APIs become available.

---

## 5. UI structure (first draft)

| View | Contents |
|---|---|
| **Home** | My open MRs/PRs with pipeline and review status, my work items in the current sprint, active agent sessions, memory inbox (count), costs this week. |
| **Projects** | Per project: linked repositories and tracker projects, MRs, sprint board, sessions, project instructions and memory. |
| **Work** | Filtered list of work items across all sources, with a sprint view. From a work item: "start an agent session with this". |
| **Sessions** | Running and finished agent sessions, streamed output, handling of permission requests. |
| **Configuration** | MCP servers, skills, instructions, generators with diff preview, drift notifications. |
| **Models** | Providers, Ollama model management (pull/delete/loaded), routing rules. |
| **Memory** | Inbox (proposed notes), confirmed notes per scope, RAG index status. |
| **Costs & resources** | Charts, breakdowns and a live resource panel. |

---

## 6. Performance budget

Target values. Exceeding them is treated as a bug.

| Component | Budget |
|---|---|
| Shell + frontend idle | < 150 MB RAM |
| Core service idle | < 200 MB RAM, < 1% CPU |
| Cold start to usable UI | < 3 s |
| Dashboard load (from cache) | < 200 ms |
| Polling per source | default ≥ 2 min, configurable |

Heavy consumers that the app **manages but does not cause**, and which must therefore be visible:
- Agent sessions: a few hundred MB each.
- MCP servers: 50–150 MB per process, per session when using stdio. Hence shared hosting.
- Local models: from ~0.3 GB (embeddings) to ~20 GB or more (coding models), plus KV cache. Local coding models are optional and experimental.

---

## 7. Data storage

- **SQLite database** in the OS's app data directory (`%APPDATA%/Helmstead`, `~/Library/Application Support/Helmstead`, `~/.local/share/helmstead`).
- **Migrations** via EF Core.
- **Secrets** only in the OS keychain. The database only holds references.
- **Transcripts** as files (JSONL) next to the database, with a configurable retention period.
- **Export and import** of configuration and memory as JSON/markdown, so users are never locked in.

---

## 8. Roadmap

Each phase delivers something usable on its own. Work through the phases in order. A phase is only done when all of its acceptance criteria are met.

### Phase 0 — Foundation

**Deliverables:**
- An Nx workspace with `apps/shell` (Tauri), `apps/web` (Angular), `apps/core` (.NET) and `libs/` for shared types and UI.
- Tauri starts the .NET core as a sidecar with a random port and a session token (§3.3).
- A health check endpoint and a basic layout with navigation (§5).
- SQLite with EF Core migrations and a keychain abstraction (`ISecretStore`).
- Logging (structured, rotating log files) and a settings page.
- CI: build, lint and tests for all three apps, on Windows, macOS and Linux.

**Acceptance criteria:**
- The app starts on Windows, macOS and Linux, the UI shows the core service's health, and the sidecar stops when the app closes.
- A secret can be stored and read back via the keychain, and is not present in SQLite.
- Requests without a valid token receive a 401.

### Phase 1 — Configuration management

**Deliverables:**
- CRUD for MCP servers, skills and instructions (global and per project).
- Import of existing Claude Code and Codex configuration.
- Generators for Claude Code and Codex, with diff preview and drift detection.

**Acceptance criteria:**
- An existing `.mcp.json` and CLAUDE.md are imported correctly and can be regenerated identically (round-trip test).
- No file is written without confirmation after a diff.
- A manual change to a generated file is detected and reported.

### Phase 2 — Work overview (GitLab + YouTrack)

**Deliverables:**
- Connectors for GitLab and YouTrack (PAT authentication).
- The normalized model with configurable status mapping, and a SQLite cache with polling.
- The Home, Projects and Work views for these sources.

**Acceptance criteria:**
- My open MRs show the correct pipeline, review and thread status, verified against the GitLab UI.
- The current sprint board of a YouTrack project shows the same items as YouTrack.
- The Home dashboard loads from cache in under 200 ms.
- Connector tests run against recorded API responses (fixtures), not live APIs.

### Phase 3 — Agent runtime (Claude Code)

**Deliverables:**
- An ACP client, session management, streamed output in the UI and permission request handling.
- Starting a session from a project or work item, with the work item's context as the initial context.
- Transcript storage and a limit on concurrent sessions.

**Acceptance criteria:**
- A Claude Code session can be started, followed, interrupted and ended from the UI.
- Permission requests appear in the UI and the user's choice is respected.
- No orphaned agent or MCP processes remain after the app closes.

### Phase 4 — Providers and local models

**Deliverables:**
- The provider registry, Ollama management (list, pull with progress, delete, loaded models) and `num_ctx`/`keep_alive` settings.
- Routing rules.
- An option to run a harness on a different provider, marked as **experimental**.

**Acceptance criteria:**
- Downloading a model shows live progress and the model is usable afterwards.
- The resource panel shows loaded models with their memory usage.
- A routing rule with `CloudForbidden` demonstrably prevents a cloud provider from being called for that project.

### Phase 5 — Memory and RAG

**Deliverables:**
- Memory extraction after sessions (local model), an inbox, confirmed notes per scope and injection at session start.
- A RAG index for project documentation with incremental reindexing.
- The `helmstead-memory` MCP server.

**Acceptance criteria:**
- A decision made and confirmed in session A is available in session B (same project) without the user repeating it.
- Rejected notes do not come back.
- `search_docs` finds a relevant passage from `docs/` for a natural-language question (evaluation set of at least 20 questions per test project).

### Phase 6 — Costs and resources

**Deliverables:**
- Integration with the Anthropic and OpenAI usage APIs, subscription usage estimates from local logs, and counting of local usage.
- The Costs & resources dashboard.

**Acceptance criteria:**
- API costs deviate at most 1% from the vendor dashboard over the same period.
- Estimated amounts are clearly marked as estimates in the UI.

### Phase 7 — More sources and harnesses

**Deliverables:**
- Connectors for GitHub and Jira.
- A Codex harness via ACP, plus generators.
- Launchers for Claude app surfaces.

**Acceptance criteria:**
- The same views work for GitHub and Jira without source-specific code in the UI.
- A Codex session behaves functionally the same as a Claude Code session in the UI.

### Phase 8 — Learning from patterns

**Deliverables:**
- Pattern detection across sessions and proposals for skills or instructions in the inbox, with a rationale.

**Acceptance criteria:**
- Every proposal references the sessions it is based on.
- No changes are applied without confirmation.

---

## 9. Quality and testing

- **Core service:** xUnit. Unit tests for mapping and domain logic, integration tests with in-memory SQLite. Connectors are tested with recorded HTTP fixtures.
- **Frontend:** unit tests for services and stores, and component tests for critical views.
- **End-to-end:** a smoke test that starts the app, checks health and loads a dashboard.
- **Contract tests** for the generators: round-trip import → generate → compare.
- **No live API calls in CI.** Live tests only run manually and are clearly marked.
- Linting and formatting are enforced in CI (ESLint/Prettier, `dotnet format`).

---

## 10. Instructions for AI coding agents

These instructions apply to any AI agent (and are useful guidance for human contributors too).

1. **Work phase by phase** (§8). Do not start a new phase until the current phase's acceptance criteria are met and a maintainer has approved.
2. **Read this document and `docs/adr/` first** before making design decisions. If you deviate from the principles in §2, write an ADR first (`docs/adr/NNN-title.md`: context, decision, consequences) and ask for approval.
3. **Verify external APIs and formats** against current documentation before implementing them (see the list in §3.2). Do not rely on memory: ACP, Codex config, Ollama and the usage APIs change quickly.
4. **Small, reviewable steps.** One logical change per commit, with tests. Commit messages in English, imperative mood (Conventional Commits).
5. **Keep the harness/model/connector separation clean.** No source- or harness-specific code outside the relevant adapter.
6. **Never log secrets, never store them in SQLite, never put them in generated config files** (use environment references or the harness's keychain integration where possible).
7. **No silent writes** to files outside the app data directory. Always show a diff and ask for confirmation.
8. **When in doubt about intended behavior, ask.** Do not guess on choices that affect the domain model or the storage structure.
9. Keep this document up to date. Update the status per phase and add new open questions to §11.

---

## 11. Open questions

- Tauri or Electron: decide in ADR-001 after a short spike (sidecar management and keychain integration on all three platforms).
- Is there a mature .NET ACP library, or do we build our own client?
- Webhooks via a tunnel (later) or polling permanently?
- Should the app also show git operations itself (branches, local changes), or leave that to the IDE?
- How do we handle multiple GitLab instances or accounts (for example self-hosted and gitlab.com)? The model supports multiple connections via `ConnectionId`, but the UI does not yet.
- Transcript retention and privacy: 90 days by default?
- Which test projects do we use for the RAG evaluation set?
- License: MIT or Apache-2.0? (Apache-2.0 adds an explicit patent grant.)
- Plugin model for third-party connectors and harnesses: in-process .NET assemblies, or out-of-process (for example via MCP)?
- Distribution: signed installers per platform, auto-update channel.

---

## 12. Repository structure (proposal)

```
helmstead/
├─ apps/
│  ├─ shell/            # Tauri v2 (Rust, minimal: sidecar, token, window management)
│  ├─ web/              # Angular frontend
│  └─ core/             # .NET core service
│     ├─ src/
│     │  ├─ Helmstead.Core.Api/            # minimal APIs, SSE, auth
│     │  ├─ Helmstead.Core.Domain/         # model, interfaces
│     │  ├─ Helmstead.Core.Persistence/    # EF Core, sqlite-vec
│     │  ├─ Helmstead.Agents/              # ACP client, session management
│     │  ├─ Helmstead.Connectors.GitLab/
│     │  ├─ Helmstead.Connectors.YouTrack/
│     │  ├─ Helmstead.Connectors.GitHub/
│     │  ├─ Helmstead.Connectors.Jira/
│     │  ├─ Helmstead.Providers/           # registry, Ollama, routing
│     │  ├─ Helmstead.Config/              # registry + generators
│     │  ├─ Helmstead.Memory/              # extraction, RAG, MCP server
│     │  └─ Helmstead.Usage/
│     └─ tests/
├─ libs/
│  ├─ api-contracts/     # shared DTOs (generated from OpenAPI)
│  └─ ui/               # shared Angular components
├─ docs/
│  ├─ plan.md           # this document
│  └─ adr/
├─ AGENTS.md            # agent working instructions (refers to docs/plan.md §10)
├─ CLAUDE.md            # same, or a reference to AGENTS.md
├─ CONTRIBUTING.md
├─ CODE_OF_CONDUCT.md
├─ SECURITY.md          # how to report vulnerabilities
└─ LICENSE
```
