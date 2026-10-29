using System.Reflection;
using Helmstead.Core.Api.Shared.Cqrs;

namespace Helmstead.Core.Api.Features.Health.Queries;

public sealed record HealthResponse(string Status, string Version);

public sealed record GetHealth : IQuery<HealthResponse>;

public sealed class GetHealthHandler : IQueryHandler<GetHealth, HealthResponse>
{
    private static readonly string Version = typeof(GetHealthHandler).Assembly
        .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0";

    public Task<HealthResponse> Handle(GetHealth query, CancellationToken cancellationToken) =>
        Task.FromResult(new HealthResponse("ok", Version));
}
