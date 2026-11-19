using System.Net.Http.Headers;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Helmstead.Core.Tests.Api;

/// <summary>
/// The core in memory, started the way the shell starts it: with a fresh session token in
/// <c>HELMSTEAD_SESSION_TOKEN</c> (spec 004). The variable is process-wide, so every start goes through
/// <see cref="SessionEnvironment.Gate"/>, and the core removes it again while starting.
/// </summary>
public class CoreApp : WebApplicationFactory<Program>
{
    /// <summary>The address the test clients use. TestServer has no socket; this host and port are what it reports.</summary>
    public static readonly Uri BaseAddress = new("http://127.0.0.1:5108/");

    /// <summary>The session token this core was started with, built at runtime (never a literal; ADR-005).</summary>
    public string Token { get; } = SessionEnvironment.NewToken();

    /// <summary>The value of <c>HELMSTEAD_SESSION_TOKEN</c> right after the core started, before any clean-up.</summary>
    public string? VariableAfterStartup { get; private set; }

    // WebApplicationFactory defaults to http://localhost, which the host check refuses.
    public CoreApp() => ClientOptions.BaseAddress = BaseAddress;

    protected override IHost CreateHost(IHostBuilder builder)
    {
        lock (SessionEnvironment.Gate)
        {
            Environment.SetEnvironmentVariable(SessionEnvironment.Variable, Token);
            try
            {
                var host = base.CreateHost(builder);
                ReportTestAddress(host);
                VariableAfterStartup = Environment.GetEnvironmentVariable(SessionEnvironment.Variable);
                return host;
            }
            finally
            {
                Environment.SetEnvironmentVariable(SessionEnvironment.Variable, null);
            }
        }
    }

    /// <summary>
    /// TestServer listens on no socket, so it reports no address and the host check would refuse every request. It is
    /// given the one its clients use; a Kestrel-backed test reports the real one itself.
    /// </summary>
    private static void ReportTestAddress(IHost host)
    {
        if (host.Services.GetRequiredService<IServer>() is TestServer server)
        {
            var addresses = server.Features.Get<IServerAddressesFeature>();
            if (addresses is null)
            {
                addresses = new ServerAddressesFeature();
                server.Features.Set(addresses);
            }

            addresses.Addresses.Add(BaseAddress.GetLeftPart(UriPartial.Authority));
        }
    }

    /// <summary>A client that sends the session token, as the web app does.</summary>
    public HttpClient CreateAuthorizedClient()
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        return client;
    }
}

public static class SessionEnvironment
{
    public const string Variable = "HELMSTEAD_SESSION_TOKEN";

    /// <summary>Serialises every test that sets or reads the variable, since tests run in parallel.</summary>
    public static readonly object Gate = new();

    /// <summary>32 random bytes as base64url, the format the shell uses.</summary>
    public static string NewToken() => Base64Url(RandomNumberGenerator.GetBytes(32));

    public static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
