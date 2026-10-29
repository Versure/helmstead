using System.Net;

namespace Helmstead.Core.Api;

/// <summary>
/// The core service is reachable from this machine only (plan §3.3). Every address it is configured to
/// listen on must be a loopback IP literal; anything else stops startup.
/// </summary>
public static class LoopbackBinding
{
    private const string Hint = "The core service may only listen on a loopback address such as http://127.0.0.1:5108.";

    public static IEnumerable<string> ConfiguredUrls(IConfiguration configuration)
    {
        foreach (var url in Split(configuration["urls"]))
        {
            yield return url;
        }

        foreach (var endpoint in configuration.GetSection("Kestrel:Endpoints").GetChildren())
        {
            if (endpoint["Url"] is { Length: > 0 } url)
            {
                yield return url;
            }
        }

        // ASPNETCORE_HTTP_PORTS and ASPNETCORE_HTTPS_PORTS bind to every network interface.
        foreach (var key in new[] { "http_ports", "https_ports" })
        {
            foreach (var port in Split(configuration[key]))
            {
                yield return $"http://*:{port}";
            }
        }
    }

    public static void Validate(IConfiguration configuration) => Validate(ConfiguredUrls(configuration));

    public static void Validate(IEnumerable<string> urls)
    {
        var configured = urls.ToArray();
        if (configured.Length == 0)
        {
            throw new InvalidOperationException($"No listen address is configured. {Hint}");
        }

        foreach (var url in configured)
        {
            if (!IsLoopback(url))
            {
                throw new InvalidOperationException($"Refusing to listen on '{url}': it is not a loopback address. {Hint}");
            }
        }
    }

    private static bool IsLoopback(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
        {
            return false;
        }

        // Only IP literals count: "localhost" and host names depend on name resolution.
        return IPAddress.TryParse(uri.Host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address);
    }

    private static IEnumerable<string> Split(string? value) =>
        (value ?? string.Empty).Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
