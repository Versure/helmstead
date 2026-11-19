using System.Net;
using System.Net.Sockets;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace Helmstead.Core.Api.Shared.Session;

/// <summary>
/// The checks every request passes before anything else of the app sees it (spec 004, ADR-006), in this order:
/// <list type="number">
/// <item>Host: a loopback IP literal with a port the core listens on, else 403. Stops DNS rebinding.</item>
/// <item>Origin: absent or in <see cref="AllowedOrigins"/>, else 403. Stops web pages, preflights included.</item>
/// <item>Token: <c>Authorization: Bearer &lt;session token&gt;</c>, else 401. Stops every other local caller.</item>
/// </list>
/// The checks are installed as the outermost startup filter, so they run before host filtering, routing and every
/// endpoint, and no endpoint can opt out.
/// </summary>
public static class SessionChecks
{
    /// <summary>
    /// Origins allowed to call the core. Empty: no web page may. A constant, so nothing at runtime can widen it; the
    /// shell spec (005) adds exactly the webview's origin.
    /// </summary>
    public static IReadOnlyList<string> AllowedOrigins { get; } = [];

    /// <summary>
    /// Registers the checks for <paramref name="token"/>. They go first in the startup filters, so they wrap the whole
    /// pipeline, including the host filtering that ASP.NET Core adds itself.
    /// </summary>
    public static IServiceCollection AddSessionChecks(this IServiceCollection services, SessionToken token)
    {
        services.AddSingleton(token);
        services.Insert(0, ServiceDescriptor.Singleton<IStartupFilter, SessionChecksStartupFilter>());

        // "Request starting" (Information) logs the full URL, so a token a client put in the query string would land in
        // the log. These rules come after every other one, so no log setting can turn that message back on.
        services.PostConfigure<LoggerFilterOptions>(options =>
        {
            foreach (var provider in options.Rules.Select(rule => rule.ProviderName).Append(null).Distinct().ToArray())
            {
                options.Rules.Add(new LoggerFilterRule(provider, "Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning, null));
            }
        });

        return services;
    }

    private sealed class SessionChecksStartupFilter : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) =>
            app =>
            {
                app.UseMiddleware<SessionCheckMiddleware>();
                next(app);
            };
    }
}

internal enum Refusal
{
    Host,
    Origin,
    Token,
}

internal sealed partial class SessionCheckMiddleware(RequestDelegate next, SessionToken token, IServer server, ILogger<SessionCheckMiddleware> logger)
{
    private const string BearerPrefix = "Bearer ";

    public Task InvokeAsync(HttpContext context)
    {
        var refusal = Check(context.Request);
        if (refusal is null)
        {
            return next(context);
        }

        // Only the reason and the remote port: nothing from the headers, which may hold a token or an attacker's text.
        LogRefused(logger, refusal.Value.ToString().ToLowerInvariant(), context.Connection.RemotePort);
        return refusal == Refusal.Token ? Unauthorized(context.Response) : Forbidden(context.Response);
    }

    private Refusal? Check(HttpRequest request)
    {
        if (!IsLoopbackHostWithListeningPort(request))
        {
            return Refusal.Host;
        }

        if (request.Headers.ContainsKey(HeaderNames.Origin) && !IsAllowedOrigin(request.Headers.Origin))
        {
            return Refusal.Origin;
        }

        return HasSessionToken(request) ? null : Refusal.Token;
    }

    private bool IsLoopbackHostWithListeningPort(HttpRequest request)
    {
        var host = request.Host;
        if (!host.HasValue || !IsLoopbackLiteral(host.Host))
        {
            return false;
        }

        var port = host.Port ?? (request.IsHttps ? 443 : 80);
        return ListeningPorts().Contains(port);
    }

    /// <summary>
    /// 127.0.0.0/8 in dotted-quad form, or [::1]. Only the canonical spelling counts, so "127.1", "2130706433" or a
    /// mapped address are refused; names such as "localhost" depend on name resolution and are refused as well.
    /// </summary>
    internal static bool IsLoopbackLiteral(string host)
    {
        if (host.StartsWith('[') && host.EndsWith(']'))
        {
            return IPAddress.TryParse(host[1..^1], out var v6)
                && v6.AddressFamily == AddressFamily.InterNetworkV6
                && v6.Equals(IPAddress.IPv6Loopback);
        }

        return IPAddress.TryParse(host, out var v4)
            && v4.AddressFamily == AddressFamily.InterNetwork
            && v4.ToString() == host
            && v4.GetAddressBytes()[0] == 127;
    }

    /// <summary>The ports the server listens on, as it reports them after binding (so port 0 resolves to the real one).</summary>
    private IEnumerable<int> ListeningPorts() =>
        (server.Features.Get<IServerAddressesFeature>()?.Addresses ?? [])
            .Select(address => BindingAddress.Parse(address).Port);

    private static bool IsAllowedOrigin(Microsoft.Extensions.Primitives.StringValues origin) =>
        origin.Count == 1 && SessionChecks.AllowedOrigins.Contains(origin[0], StringComparer.Ordinal);

    private bool HasSessionToken(HttpRequest request)
    {
        var authorization = request.Headers.Authorization;
        if (authorization.Count != 1 || authorization[0] is not { } value
            || !value.StartsWith(BearerPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return token.Matches(value[BearerPrefix.Length..]);
    }

    private static Task Unauthorized(HttpResponse response)
    {
        response.Headers.WWWAuthenticate = "Bearer";
        return Problem(response, StatusCodes.Status401Unauthorized, "Unauthorized", "https://tools.ietf.org/html/rfc9110#section-15.5.2");
    }

    private static Task Forbidden(HttpResponse response) =>
        Problem(response, StatusCodes.Status403Forbidden, "Forbidden", "https://tools.ietf.org/html/rfc9110#section-15.5.4");

    /// <summary>The same fixed body for every refusal of a kind: it never says which part of the check failed.</summary>
    private static Task Problem(HttpResponse response, int status, string title, string type)
    {
        response.StatusCode = status;
        response.ContentType = "application/problem+json";
        return response.WriteAsync($$"""{"type":"{{type}}","title":"{{title}}","status":{{status}}}""");
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Refused a request: the {Reason} check failed (remote port {RemotePort}).")]
    private static partial void LogRefused(ILogger logger, string reason, int remotePort);
}
