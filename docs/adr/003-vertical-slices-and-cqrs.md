# 003 — Vertical slices and CQRS in the core

- Status: accepted
- Date: 2026-10-29

## Context

The owner asked, in review of spec 001, for the backend to be organised as vertical slices and to use CQRS whenever it
interacts with data. A layer split (Domain, Persistence, Api projects) spreads one feature over three projects and
lets features reach into each other's code. Plan §2 and §10 rule 5 ask for separation that is enforced, not agreed.

## Decision

`Helmstead.Core.Api` is organised by feature, not by layer:

```
Helmstead.Core.Api/
  Features/<Slice>/            endpoints and wiring of one feature
    Commands/                  commands and their handlers: change state
    Queries/                   queries, their results and handlers: only read state
    Domain/                    the feature's own domain types
  Shared/                      the kernel every slice may use (for example `Shared/Cqrs.cs`)
```

A command implements `ICommand<TResult>` and is handled by one `ICommandHandler`. A query implements
`IQuery<TResult>` and is handled by one `IQueryHandler`. Handlers are registered by scanning the assembly
(`AddHandlers`); there is no mediator library. The first slice is `Features/Health`, a query.

ArchUnitNET tests enforce this (`ArchitectureRules.cs`, each with a violating fixture in `Helmstead.Core.Api.Fixture`):

- A slice references no other slice. Slices share code only through `Shared`.
- `Shared` references no slice.
- Queries reference no commands, and commands reference no queries. This includes the shared contracts: a query cannot
  take an `ICommandHandler`, and a command cannot take an `IQueryHandler`.
- Queries never write: no call to a method named `SaveChanges*`, `ExecuteUpdate*` or `ExecuteDelete*`, also from async
  code and lambdas (proved by fixtures).
- Domain code references no ASP.NET Core, no EF Core and no `System.Net.Http`.
- Every type under `Features` sits in `Features/<Slice>`, `Commands`, `Queries` or `Domain`; any other folder fails a
  test, because the rules above match those folders.

## Consequences

- A feature is added, changed or deleted in one folder. Reviewers read one slice.
- Cross-slice behaviour needs a deliberate step: move the shared part into `Shared`, or call the other slice over a
  contract defined in `Shared`. There is no shortcut by reference.
- "Queries never write" checks method names, because EF Core is not a dependency yet. It misses other ways to write
  (raw SQL, `Add`/`Remove` on a set, files). When storage is chosen, the rule is tightened to the real types (for
  example a read-only context for queries) in the spec that adds storage.
- The slice layout is by folder and namespace inside one assembly. The namespace rules would carry over to a slice
  that becomes its own assembly, but the assembly name patterns accept `Helmstead.Core.Api*` only, so that move needs
  an ADR and a rule update.
- The former `Helmstead.Core.Domain` and `Helmstead.Core.Persistence` projects are gone. The "domain depends on nothing"
  rule of plan §2 survives only in part: domain code may not use ASP.NET Core, EF Core or `System.Net.Http`, but it
  may still reference other code of its slice and `Shared`. A stricter rule is for the owner to ask for.
- "Only `Helmstead.Core.Api` references ASP.NET Core" now matters for future assemblies only, because all core code
  lives in that one assembly today.
