using System.Net;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;

namespace Helmstead.Core.Tests.Api.Session;

/// <summary>
/// Spec 004 criterion 8 against a real socket: the core on 127.0.0.1 with a port the OS picks, so the host check
/// decides on the port Kestrel actually listens on. Loopback only, which the network guard allows.
/// </summary>
public sealed class KestrelHostTests : IAsyncLifetime
{
    private readonly CoreApp app = new();
    private Uri address = null!;

    public Task InitializeAsync()
    {
        app.UseKestrel(options => options.Listen(IPAddress.Loopback, 0));
        app.StartServer();
        address = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single());
        return Task.CompletedTask;
    }

    public async Task DisposeAsync() => await app.DisposeAsync();

    [Fact]
    public async Task The_listening_address_with_the_token_is_accepted()
    {
        using var response = await Send($"127.0.0.1:{address.Port}", authorized: true);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task The_listening_address_without_the_token_gets_401()
    {
        using var response = await Send($"127.0.0.1:{address.Port}", authorized: false);

        await RequestCheckTests.AssertUnauthorized(response);
    }

    [Theory]
    [InlineData("wrong port")]
    [InlineData("localhost")]
    [InlineData("foreign name")]
    [InlineData("default port")]
    public async Task Another_host_gets_403_even_with_the_token(string what)
    {
        var host = what switch
        {
            "wrong port" => $"127.0.0.1:{(address.Port == 5108 ? 5109 : 5108)}",
            "localhost" => $"localhost:{address.Port}",
            "foreign name" => $"attacker.example:{address.Port}",
            _ => "127.0.0.1",
        };

        using var response = await Send(host, authorized: true);

        await RequestCheckTests.AssertForbidden(response);
    }

    private async Task<HttpResponseMessage> Send(string host, bool authorized)
    {
        using var client = new HttpClient { BaseAddress = address };
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Host = host;
        if (authorized)
        {
            request.Headers.Authorization = new("Bearer", app.Token);
        }

        return await client.SendAsync(request);
    }
}
