using Helmstead.Core.Api.Features.Billing;
using Helmstead.Core.Api.Features.Orders.Commands;
using Helmstead.Core.Api.Features.Orders.Queries;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

// Stands in for EF Core, which is not a dependency yet. The rules match on the namespace and the method name.
namespace Microsoft.EntityFrameworkCore
{
    public sealed class FixtureDbContext
    {
        public Task<int> SaveChangesAsync() => Task.FromResult(0);
    }
}

namespace Helmstead.Core.Api.Features.Billing
{
    /// <summary>Test fixture: a second slice for the Orders slice to wrongly depend on.</summary>
    public sealed class Invoice;
}

namespace Helmstead.Core.Api.Features.Orders.Domain
{
    /// <summary>Test fixture: domain code wrongly depends on ASP.NET Core, EF Core and System.Net.Http.</summary>
    public sealed class OrderDomainType
    {
        public HttpContext? Context { get; set; }

        public FixtureDbContext? Database { get; set; }

        public HttpClient? Client { get; set; }
    }
}

namespace Helmstead.Core.Api.Features.Orders.Commands
{
    /// <summary>Test fixture: a command wrongly depends on a query.</summary>
    public sealed class PlaceOrder
    {
        public ListOrders? Reader { get; set; }
    }
}

namespace Helmstead.Core.Api.Features.Orders.Queries
{
    /// <summary>Test fixture: a query wrongly depends on a command, another slice, and writes.</summary>
    public sealed class ListOrders
    {
        public PlaceOrder? Writer { get; set; }

        public Invoice? Other { get; set; }

        public Task<int> Run(FixtureDbContext database) => database.SaveChangesAsync();
    }
}

namespace Helmstead.Core.Api.Shared
{
    /// <summary>Test fixture: the shared kernel wrongly depends on a slice.</summary>
    public sealed class SharedFixtureType
    {
        public Invoice? Invoice { get; set; }
    }
}

namespace Helmstead.Core.Api.Features.Orders.Queries
{
    using Helmstead.Core.Api.Shared.Cqrs;

    public sealed record PlaceOrderCommand : ICommand<int>;

    public sealed record ReadOrderQuery : IQuery<int>;

    /// <summary>Test fixture: a query wrongly takes a command handler from the shared contracts.</summary>
    public sealed class SneakyQueryHandler(ICommandHandler<PlaceOrderCommand, int> writer)
    {
        public ICommandHandler<PlaceOrderCommand, int> Writer { get; } = writer;
    }

    /// <summary>Test fixture: an async query handler that writes (the call sits in a compiler-generated state machine).</summary>
    public sealed class AsyncWriter
    {
        public async Task<int> Run(FixtureDbContext database)
        {
            await Task.Yield();
            return await database.SaveChangesAsync();
        }
    }

    /// <summary>Test fixture: a query handler that writes from a lambda (a compiler-generated closure).</summary>
    public sealed class LambdaWriter
    {
        public Func<Task<int>> Run(FixtureDbContext database) => () => database.SaveChangesAsync();
    }
}

namespace Helmstead.Core.Api.Features.Orders.Commands
{
    using Helmstead.Core.Api.Shared.Cqrs;

    /// <summary>Test fixture: a command wrongly takes a query handler from the shared contracts.</summary>
    public sealed class SneakyCommandHandler(IQueryHandler<ReadOrderQuery, int> reader)
    {
        public IQueryHandler<ReadOrderQuery, int> Reader { get; } = reader;
    }
}

namespace Helmstead.Core.Api.Features.Orders.Handlers
{
    /// <summary>Test fixture: a folder outside the layout (Commands, Queries, Domain), which would escape the CQRS rules.</summary>
    public sealed class MisplacedHandler;
}

namespace Helmstead.Core.Api.Features.Clean.Queries
{
    using Helmstead.Core.Api.Shared.Cqrs;

    public sealed record ReadCleanQuery : IQuery<int>;

    /// <summary>Test fixture: a compliant slice. No rule may report it (a positive control).</summary>
    public sealed class ReadCleanHandler : IQueryHandler<ReadCleanQuery, int>
    {
        public Task<int> Handle(ReadCleanQuery query, CancellationToken cancellationToken) => Task.FromResult(1);
    }
}
