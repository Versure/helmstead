using Microsoft.AspNetCore.Http;

namespace Helmstead.Web.Fixture;

/// <summary>Test fixture: an assembly other than Helmstead.Core.Api wrongly depends on ASP.NET Core.</summary>
public sealed class WebFixtureType
{
    public HttpContext? Context { get; set; }
}
