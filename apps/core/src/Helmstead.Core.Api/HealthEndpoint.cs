using System.Reflection;

namespace Helmstead.Core.Api;

public sealed record HealthResponse(string Status, string Version);

public static class HealthEndpoint
{
    public static IEndpointRouteBuilder MapHealth(this IEndpointRouteBuilder routes)
    {
        var version = typeof(HealthEndpoint).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";

        routes.MapGet("/health", () => new HealthResponse("ok", version))
            .WithName("GetHealth")
            .Produces<HealthResponse>();

        return routes;
    }
}
