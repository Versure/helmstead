using Helmstead.Core.Api.Features.Health.Queries;
using Helmstead.Core.Api.Shared.Cqrs;
using Microsoft.Extensions.DependencyInjection;

namespace Helmstead.Core.Tests.Api;

public sealed class CqrsRegistrationTests
{
    [Fact]
    public async Task Handlers_of_an_assembly_are_registered_by_their_message_type()
    {
        var services = new ServiceCollection();
        services.AddHandlers(typeof(GetHealth).Assembly);
        await using var provider = services.BuildServiceProvider();

        var handler = provider.GetRequiredService<IQueryHandler<GetHealth, HealthResponse>>();
        var response = await handler.Handle(new GetHealth(), CancellationToken.None);

        Assert.Equal("ok", response.Status);
    }

    [Fact]
    public void A_handler_is_registered_once_per_assembly_scan()
    {
        var services = new ServiceCollection();
        services.AddHandlers(typeof(GetHealth).Assembly);

        Assert.Single(services, service => service.ServiceType == typeof(IQueryHandler<GetHealth, HealthResponse>));
    }
}
