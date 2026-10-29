using Helmstead.Core.Api.Features.Health.Queries;
using Helmstead.Core.Api.Shared.Cqrs;

namespace Helmstead.Core.Api.Features.Health;

public static class HealthEndpoint
{
    public static IEndpointRouteBuilder MapHealth(this IEndpointRouteBuilder routes)
    {
        routes.MapGet(
                "/health",
                (IQueryHandler<GetHealth, HealthResponse> handler, CancellationToken cancellationToken) =>
                    handler.Handle(new GetHealth(), cancellationToken))
            .WithName("GetHealth")
            .Produces<HealthResponse>();

        return routes;
    }
}
