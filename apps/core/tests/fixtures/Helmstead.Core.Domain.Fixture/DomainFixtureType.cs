using Helmstead.Connectors.FixtureB;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

// Stands in for EF Core, which is not a dependency yet. The rule matches on the namespace.
namespace Microsoft.EntityFrameworkCore
{
    public sealed class FixtureDbContext;
}

namespace Helmstead.Core.Domain.Fixture
{
    /// <summary>Test fixture: Domain wrongly depends on another Helmstead assembly, ASP.NET Core, EF Core and System.Net.Http.</summary>
    public sealed class DomainFixtureType
    {
        public string Name => new FixtureBType().Name;

        public HttpContext? Context { get; set; }

        public FixtureDbContext? Database { get; set; }

        public HttpClient? Client { get; set; }
    }
}
