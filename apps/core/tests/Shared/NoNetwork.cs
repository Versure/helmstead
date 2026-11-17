using System.Net;
using System.Runtime.CompilerServices;

namespace Helmstead.Testing;

/// <summary>
/// Keeps tests off the network (plan §9: no live API calls in tests; spec 003). This file is linked into every test
/// project by <c>apps/core/tests/Directory.Build.props</c>, and its module initializer runs before any test code.
/// <para>
/// It points <see cref="HttpClient.DefaultProxy"/> at a loopback port where nothing listens, and lets only loopback
/// addresses bypass it. Every <see cref="HttpClient"/> that does not set its own proxy (including the ones from
/// <c>IHttpClientFactory</c>) then fails fast for a non-loopback host, while <c>WebApplicationFactory</c> clients
/// (in memory) and fake <see cref="HttpMessageHandler"/>s are untouched. The ArchUnitNET rule in
/// <c>Architecture/NetworkRules.cs</c> forbids test code the ways around it: raw sockets, its own proxy settings.
/// </para>
/// <para>
/// A test that really needs a live API is marked <c>[Trait("Category", "Live")]</c> and runs only with
/// <c>HELMSTEAD_LIVE_TESTS=1</c>, which also skips this guard.
/// </para>
/// </summary>
internal static class NoNetwork
{
    /// <summary>The unreachable proxy: the discard port on loopback, which nothing listens on.</summary>
    public const string ProxyEndpoint = "127.0.0.1:9";

    public static bool Installed { get; private set; }

#pragma warning disable CA2255 // A module initializer in a library is exactly what is wanted here.
    [ModuleInitializer]
#pragma warning restore CA2255
    internal static void Install()
    {
        if (Environment.GetEnvironmentVariable("HELMSTEAD_LIVE_TESTS") == "1")
        {
            return;
        }

        HttpClient.DefaultProxy = new LoopbackOnlyProxy(new Uri($"http://{ProxyEndpoint}/"));
        Installed = true;
    }

    /// <summary>
    /// Sends every non-loopback request to the unreachable proxy. It never throws: .NET ignores a proxy that throws
    /// and connects directly, so failing closed means returning the dead proxy.
    /// </summary>
    private sealed class LoopbackOnlyProxy(Uri proxy) : IWebProxy
    {
        public ICredentials? Credentials { get; set; }

        public Uri GetProxy(Uri destination) => proxy;

        public bool IsBypassed(Uri host) => IsLoopback(host.IdnHost);
    }

    public static bool IsLoopback(string host)
    {
        var name = host.Trim('[', ']');
        return string.Equals(name, "localhost", StringComparison.OrdinalIgnoreCase)
            || (IPAddress.TryParse(name, out var address) && IPAddress.IsLoopback(address));
    }
}
