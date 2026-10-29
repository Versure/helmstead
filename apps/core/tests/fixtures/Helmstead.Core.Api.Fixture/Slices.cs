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
