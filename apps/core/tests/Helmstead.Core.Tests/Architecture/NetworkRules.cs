using System.Text.RegularExpressions;
using ArchUnitNET.Domain;
using ArchUnitNET.Domain.Dependencies;

namespace Helmstead.Core.Tests.Boundaries;

/// <summary>
/// The network ban for test code (spec 003 criterion 15). <c>Shared/NoNetwork.cs</c> sends every HttpClient without a
/// proxy of its own to a dead loopback proxy; this rule forbids test code the ways around it. Only NoNetwork itself
/// may use these. A change to either list is a change to the guard and is high risk.
/// </summary>
public static class NetworkRules
{
    /// <summary>Test code: the <c>*.Tests</c> assemblies, and fixtures named like them for the negative tests.</summary>
    private static readonly Regex TestCode = new(@"^Helmstead\.(.+\.)?Tests(\.|$)");

    private const string Guard = "Helmstead.Testing.NoNetwork";

    /// <summary>Types that open connections, or proxies, outside the guard.</summary>
    public static IReadOnlyList<string> ForbiddenTypes { get; } =
    [
        "System.Net.Sockets.Socket",
        "System.Net.Sockets.TcpClient",
        "System.Net.Sockets.UdpClient",
        "System.Net.WebProxy",
        "System.Net.IWebProxy",
        "System.Net.Dns",
        "System.Net.Mail.SmtpClient",
        "System.Net.NetworkInformation.Ping",
        "System.Net.Quic.QuicConnection",
    ];

    /// <summary>Members that take a handler, or every client, out of the guard's proxy.</summary>
    public static IReadOnlyList<string> ForbiddenMembers { get; } =
    [
        "System.Net.Http.HttpClientHandler.set_UseProxy",
        "System.Net.Http.SocketsHttpHandler.set_UseProxy",
        "System.Net.Http.HttpClientHandler.set_Proxy",
        "System.Net.Http.SocketsHttpHandler.set_Proxy",
        "System.Net.Http.SocketsHttpHandler.set_ConnectCallback",
        "System.Net.Http.HttpClient.set_DefaultProxy",
        "System.Net.WebSockets.ClientWebSocketOptions.set_Proxy",
        "System.Net.WebRequest.set_DefaultWebProxy",
        "System.Net.WebRequest.set_Proxy",
    ];

    public static LayerRule Rule { get; } = new(
        "Test code opens no network connection of its own",
        "Tests make no live calls (plan §9); only Shared/NoNetwork.cs may touch sockets and proxies (spec 003).",
        type => TestCode.IsMatch(type.Assembly.Name) && !IsGuard(type),
        Violation);

    /// <summary>Every forbidden use in the type, so a test can check each one is found.</summary>
    public static IEnumerable<string> Violations(IType type)
    {
        foreach (var dependency in type.Dependencies)
        {
            if (ForbiddenTypes.Contains(dependency.Target.FullName))
            {
                yield return dependency.Target.FullName;
            }
        }

        foreach (var call in type.Members.SelectMany(member => member.MemberDependencies.OfType<MethodCallDependency>()))
        {
            var name = $"{call.TargetMember.DeclaringType.FullName}.{call.TargetMember.Name.Split('(')[0]}";
            if (ForbiddenMembers.Contains(name))
            {
                yield return name;
            }
        }
    }

    private static string? Violation(IType type) => Violations(type).FirstOrDefault();

    private static bool IsGuard(IType type) =>
        type.FullName == Guard || type.FullName.StartsWith(Guard + "+", StringComparison.Ordinal) || type.FullName.StartsWith(Guard + "/", StringComparison.Ordinal);
}
