using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Helmstead.Core.Api.Features.Open;

// Test fixtures for the rule "No endpoint allows anonymous access" (spec 004 criterion 10): every way an endpoint
// could opt out of the session checks. Never run.

/// <summary>Opts out with the extension method.</summary>
public static class AnonymousByExtension
{
    public static void Map(IEndpointRouteBuilder routes) => routes.MapGet("/open", () => "open").AllowAnonymous();
}

/// <summary>Opts out with the attribute.</summary>
[AllowAnonymous]
public sealed class AnonymousByAttribute;

/// <summary>Opts out with its own metadata.</summary>
public sealed class AnonymousByMetadata : IAllowAnonymous;

/// <summary>Opts out with the attribute on a lambda, which the compiler moves into a generated type.</summary>
public static class AnonymousLambda
{
    public static void Map(IEndpointRouteBuilder routes) => routes.MapGet("/open-lambda", [AllowAnonymous] () => Results.Ok());
}
