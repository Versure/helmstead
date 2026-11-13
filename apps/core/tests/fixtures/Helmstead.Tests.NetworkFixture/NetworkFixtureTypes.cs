using System.Net;
using System.Net.Http;
using System.Net.Sockets;

namespace Helmstead.Tests.NetworkFixture;

// Test fixtures: test code that goes around the network guard (apps/core/tests/Shared/NoNetwork.cs) in every way the
// ArchUnitNET rule forbids. Each member is one forbidden use; the rule must report all of them. Never run.
public static class NetworkFixtureTypes
{
    public static Socket RawSocket() => new(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);

    public static TcpClient Tcp() => new();

    public static UdpClient Udp() => new();

    public static HttpClientHandler HandlerWithoutProxy() => new() { UseProxy = false };

    public static SocketsHttpHandler SocketsHandlerWithoutProxy() => new() { UseProxy = false };

    public static HttpClientHandler HandlerWithOwnProxy() => new() { Proxy = new WebProxy("http://198.51.100.1:8080") };

    public static SocketsHttpHandler SocketsHandlerWithOwnProxy() => new() { Proxy = null };

    public static SocketsHttpHandler OwnConnect() => new() { ConnectCallback = (_, _) => ValueTask.FromResult<Stream>(Stream.Null) };

    public static void ResetDefaultProxy() => HttpClient.DefaultProxy = new WebProxy();
}

/// <summary>The only forbidden use sits in a lambda, which the compiler moves into a generated type.</summary>
public static class LambdaSocket
{
    public static Task Open() => Task.Run(() => new TcpClient().Dispose());
}

/// <summary>The only forbidden use sits in an async method, which the compiler moves into a state machine.</summary>
public static class AsyncSocket
{
    public static async Task OpenAsync()
    {
        await Task.Yield();
        using var client = new UdpClient();
    }
}

/// <summary>A proxy of its own that sends everything direct.</summary>
public sealed class DirectProxy : IWebProxy
{
    public ICredentials? Credentials { get; set; }

    public Uri? GetProxy(Uri destination) => null;

    public bool IsBypassed(Uri host) => true;
}
