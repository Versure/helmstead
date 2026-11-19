using System.Reflection;
using System.Security.Cryptography;
using System.Text;

namespace Helmstead.Core.Api.Shared.Session;

/// <summary>
/// The secret every request must carry (plan §3.3, ADR-006). The shell creates it for one run of the core and hands it
/// over in <see cref="Variable"/>; the core reads it from there only, never from configuration or the command line,
/// and removes it from its own environment so child processes (agents, MCP servers) do not inherit it.
/// </summary>
public sealed class SessionToken
{
    public const string Variable = "HELMSTEAD_SESSION_TOKEN";

    /// <summary>32 random bytes as base64url without padding.</summary>
    public const int MinimumLength = 43;

    private static readonly string Rule =
        $"{Variable} must be set to the session token: at least {MinimumLength} characters (32 random bytes as base64url), " +
        "using only the characters A-Z a-z 0-9 - _. The Helmstead shell sets it; in development `npx nx serve core` does.";

    private readonly byte[] value;

    private SessionToken(byte[] value) => this.value = value;

    /// <summary>
    /// Reads the token from <see cref="Variable"/> and removes the variable from this process, valid or not. Call it
    /// before <c>WebApplication.CreateBuilder</c>, which copies every environment variable into the configuration.
    /// </summary>
    /// <exception cref="InvalidOperationException">The variable is missing or invalid. The message never holds its value.</exception>
    public static SessionToken FromEnvironment()
    {
        var value = Environment.GetEnvironmentVariable(Variable);
        Environment.SetEnvironmentVariable(Variable, null);
        return Parse(value);
    }

    /// <summary>
    /// The token for this process. When the OpenAPI document is generated at build time (by GetDocument.Insider, which
    /// builds the app but never starts the server) there is no shell and no token, so an unguessable one is made up:
    /// the checks stay in place, and no one could present it.
    /// </summary>
    public static SessionToken ForThisProcess() =>
        Assembly.GetEntryAssembly()?.GetName().Name == "GetDocument.Insider"
            ? new SessionToken(Encoding.ASCII.GetBytes(Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))))
            : FromEnvironment();

    /// <exception cref="InvalidOperationException">The value is not a valid token. The message never holds the value.</exception>
    public static SessionToken Parse(string? value)
    {
        if (value is null || value.Length < MinimumLength || !value.All(IsBase64Url))
        {
            throw new InvalidOperationException(Rule);
        }

        return new SessionToken(Encoding.ASCII.GetBytes(value));
    }

    /// <summary>Whether <paramref name="presented"/> is this token, compared in constant time for equal lengths.</summary>
    public bool Matches(string? presented)
    {
        if (presented is null)
        {
            return false;
        }

        // UTF-8, not ASCII: ASCII would turn every non-ASCII character into '?', which is not in the token anyway,
        // but a lossless encoding leaves nothing to reason about.
        return CryptographicOperations.FixedTimeEquals(value, Encoding.UTF8.GetBytes(presented));
    }

    public override string ToString() => "[session token]";

    private static bool IsBase64Url(char c) => c is (>= 'A' and <= 'Z') or (>= 'a' and <= 'z') or (>= '0' and <= '9') or '-' or '_';
}
