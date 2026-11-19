using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Helmstead.Core.Tests.Api.Session;

/// <summary>Spec 004 criterion 10: no endpoint of the app can be reached without the token.</summary>
public sealed partial class EndpointCoverageTests(CoreApp app) : IClassFixture<CoreApp>
{
    [Fact]
    public async Task Every_endpoint_answers_401_without_a_token()
    {
        _ = app.Server;
        var endpoints = app.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>().ToArray();
        using var client = app.CreateClient();

        Assert.NotEmpty(endpoints);
        foreach (var endpoint in endpoints)
        {
            var path = "/" + Parameter().Replace(endpoint.RoutePattern.RawText ?? string.Empty, "x").TrimStart('/');
            var methods = endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? ["GET", "POST", "PUT", "DELETE"];
            foreach (var method in methods)
            {
                using var request = new HttpRequestMessage(new HttpMethod(method), path);

                using var response = await client.SendAsync(request);

                await RequestCheckTests.AssertUnauthorized(response);
            }
        }
    }

    [Fact]
    public void The_session_checks_are_the_outermost_startup_filter()
    {
        _ = app.Server;

        // Startup filters wrap in registration order, the first outermost. Anything registered before the session
        // filter would run before the checks, so it must stay first.
        var first = app.Services.GetServices<Microsoft.AspNetCore.Hosting.IStartupFilter>().First();

        Assert.Equal("SessionChecksStartupFilter", first.GetType().Name);
    }

    [GeneratedRegex(@"\{[^}]*\}")]
    private static partial Regex Parameter();
}
