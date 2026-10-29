using System.Net;
using System.Reflection;
using System.Text.Json;
using Helmstead.Core.Api;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Helmstead.Core.Tests.Api;

public sealed class HealthEndpointTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Health_returns_ok_with_status_and_version_only()
    {
        using var client = factory.CreateClient();

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
