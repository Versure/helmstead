using System.Net;
using System.Reflection;
using System.Text.Json;
using Helmstead.Core.Api;

namespace Helmstead.Core.Tests.Api;

public sealed class HealthEndpointTests(CoreApp factory) : IClassFixture<CoreApp>
{
    [Fact]
    public async Task Health_returns_ok_with_status_and_version_only()
    {
        using var client = factory.CreateAuthorizedClient();

        using var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);

        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var properties = json.RootElement.EnumerateObject().Select(p => p.Name).Order().ToArray();
        Assert.Equal(["status", "version"], properties);
        Assert.Equal("ok", json.RootElement.GetProperty("status").GetString());

        var expectedVersion = typeof(Program).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()!.InformationalVersion;
        Assert.Equal(expectedVersion, json.RootElement.GetProperty("version").GetString());
    }
}
