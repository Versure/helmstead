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
- Queries reference no commands, and commands reference no queries.
- Queries never write: no call to a method named `SaveChanges*`, `ExecuteUpdate*` or `ExecuteDelete*`.
- Domain code references no ASP.NET Core, no EF Core and no `System.Net.Http`.

## Consequences

- A feature is added, changed or deleted in one folder. Reviewers read one slice.
- Cross-slice behaviour needs a deliberate step: move the shared part into `Shared`, or call the other slice over a
  contract defined in `Shared`. There is no shortcut by reference.
- "Queries never write" checks method names, because EF Core is not a dependency yet. When storage is chosen, the rule
  is tightened to the real types (for example a read-only context for queries) in the spec that adds storage.
- The slice layout is by folder and namespace inside one assembly. If a slice must become its own assembly, the rules
  already match by namespace pattern, so they carry over.
- The former `Helmstead.Core.Domain` and `Helmstead.Core.Persistence` projects are gone. The "domain depends on nothing"
  rule of plan §2 lives on as the domain-code rule above.
