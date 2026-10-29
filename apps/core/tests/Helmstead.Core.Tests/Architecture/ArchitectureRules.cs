using System.Text.RegularExpressions;
using ArchUnitNET.Domain;
using ArchUnitNET.Domain.Extensions;
using ArchUnitNET.Fluent;
using ArchUnitNET.Fluent.Conditions;
using static ArchUnitNET.Fluent.ArchRuleDefinition;
using Architecture = ArchUnitNET.Domain.Architecture;

namespace Helmstead.Core.Tests.Boundaries;

/// <summary>
/// One architecture rule: types that match <see cref="Subject"/> must not have a dependency for which
/// <see cref="Violation"/> returns a description.
/// </summary>
public sealed record LayerRule(string Name, string Why, Func<IType, bool> Subject, Func<IType, string?> Violation)
{
    public IArchRule ToArchRule() =>
        Types().That().FollowCustomPredicate(Subject, Name)
            .Should().FollowCustomCondition(
                type =>
                {
                    var violation = Violation(type);
                    return violation is null
                        ? new ConditionResult(type, true)
                        : new ConditionResult(type, false, $"depends on {violation}");
                },
                Why)
            .Because(Why)
            // Rules also cover projects that do not exist yet; the negative tests prove they can still fail.
            .WithoutRequiringPositiveResults();

    public override string ToString() => Name;
}

/// <summary>
/// The .NET architecture rules of ADR-002 and ADR-003: the core is vertical slices with CQRS, and the harness,
/// the model providers and the connectors stay separate. Rules match assemblies and namespaces by pattern,
/// so projects and slices added later are covered.
/// </summary>
public static class ArchitectureRules
{
    private const string Features = @"^Helmstead\.Core\.Api\.Features\.";

    private static readonly Regex Api = new(@"^Helmstead\.Core\.Api(\.|$)");
    private static readonly Regex NotApi = new(@"^Helmstead\.(?!Core\.Api(\.|$))");
    private static readonly Regex Connectors = new(@"^Helmstead\.Connectors\.");
    private static readonly Regex Agents = new(@"^Helmstead\.Agents(\.|$)");
    private static readonly Regex Providers = new(@"^Helmstead\.Providers(\.|$)");

    // Namespace layout of a slice: Helmstead.Core.Api.Features.<Slice>[.Commands|.Queries|.Domain].
    private static readonly Regex Slice = new(Features + @"(?<slice>[^.]+)(\.|$)");
    private static readonly Regex DomainOfSlice = new(Features + @"[^.]+\.Domain(\.|$)");
    private static readonly Regex CommandsOfSlice = new(Features + @"[^.]+\.Commands(\.|$)");
    private static readonly Regex QueriesOfSlice = new(Features + @"[^.]+\.Queries(\.|$)");
    private static readonly Regex CommandContracts = new(@"^Helmstead\.Core\.Api\.Shared\.Cqrs\.ICommand");
    private static readonly Regex QueryContracts = new(@"^Helmstead\.Core\.Api\.Shared\.Cqrs\.IQuery");
    private static readonly Regex SliceLayout = new(Features + @"[^.]+(\.(Commands|Queries|Domain)(\..+)?)?$");
    private static readonly Regex SharedKernel = new(@"^Helmstead\.Core\.Api\.Shared(\.|$)");

    private static readonly Regex AspNetCore = new(@"^Microsoft\.AspNetCore\.");
    private static readonly Regex EfCore = new(@"^Microsoft\.EntityFrameworkCore(\.|$)");
    private static readonly Regex Http = new(@"^System\.Net\.Http(\.|$)");
    private static readonly Regex Write = new(@"^(SaveChanges|ExecuteUpdate|ExecuteDelete)");

    public static IReadOnlyList<LayerRule> All { get; } =
    [
        new("Domain code references no ASP.NET Core",
            "Domain code stays free of web concerns (ADR-003).",
            InNamespace(DomainOfSlice),
            TargetMatches(AspNetCore)),
        new("Domain code references no EF Core",
            "Domain code stays free of storage concerns (ADR-003).",
            InNamespace(DomainOfSlice),
            TargetMatches(EfCore)),
        new("Domain code references no System.Net.Http",
            "Domain code does not talk to the network (ADR-003).",
            InNamespace(DomainOfSlice),
            TargetMatches(Http)),
        new("Only Api references ASP.NET Core",
            "Web concerns live in Helmstead.Core.Api only.",
            InAssembly(NotApi),
            TargetMatches(AspNetCore)),
        // Vertical slices: a feature owns its code, from endpoint to storage.
        new("A slice references no other slice",
            "A slice depends on the shared kernel only, never on another slice (ADR-003).",
            InNamespace(Slice),
            (type) => type.Dependencies
                .Select(dependency => dependency.Target)
                .Where(target => SliceOf(target) is not null && SliceOf(target) != SliceOf(type))
                .Select(target => target.FullName)
                .FirstOrDefault()),
        new("The shared kernel references no slice",
            "Shared code is below the slices, so it cannot depend on them (ADR-003).",
            InNamespace(SharedKernel),
            TargetMatches(new Regex(Features))),
        // CQRS: a command changes state, a query only reads it, and neither calls the other.
        new("Queries reference no commands",
            "A query only reads; it does not use a command (ADR-003).",
            InNamespace(QueriesOfSlice),
            TargetMatches(CommandsOfSlice)),
        new("Commands reference no queries",
            "A command does not read through a query; its handler works on the domain (ADR-003).",
            InNamespace(CommandsOfSlice),
            TargetMatches(QueriesOfSlice)),
        // The contracts live in Shared, which every slice may use, so reaching through them must be closed as well.
        new("Queries reference no command contracts",
            "A query cannot execute a command through the shared contracts (ADR-003).",
            InNamespace(QueriesOfSlice),
            TargetMatches(CommandContracts)),
        new("Commands reference no query contracts",
            "A command cannot execute a query through the shared contracts (ADR-003).",
            InNamespace(CommandsOfSlice),
            TargetMatches(QueryContracts)),
        new("Queries never write",
            "A query handler does not call SaveChanges, ExecuteUpdate or ExecuteDelete (ADR-003).",
            InNamespace(QueriesOfSlice),
            type => type.Members
                .SelectMany(member => member.GetMethodCallDependencies())
                .Select(dependency => dependency.TargetMember)
                .Where(member => Write.IsMatch(member.Name))
                .Select(member => member.FullName)
                .FirstOrDefault()),
        // One rule per forbidden edge, so that dropping one of them fails a named test.
        new("A connector references no other connector",
            "No connector-specific code outside its adapter (plan §10 rule 5).",
            InAssembly(Connectors),
            OtherAssembly(Connectors)),
        new("A connector references no Agents",
            "No connector-specific code outside its adapter (plan §10 rule 5).",
            InAssembly(Connectors),
            OtherAssembly(Agents)),
        new("A connector references no Providers",
            "No connector-specific code outside its adapter (plan §10 rule 5).",
            InAssembly(Connectors),
            OtherAssembly(Providers)),
        new("Agents references no connector",
            "Harness and connector stay separate (plan §2 principle 1).",
            InAssembly(Agents),
            OtherAssembly(Connectors)),
        new("Providers references no connector",
            "Model providers know no connectors.",
            InAssembly(Providers),
            OtherAssembly(Connectors)),
        new("Providers references no Agents",
            "Model providers know no harnesses (plan §2 principle 1).",
            InAssembly(Providers),
            OtherAssembly(Agents)),
    ];

    /// <summary>
    /// Every assembly under src/ must match one of these, so a project named outside the scheme fails a test
    /// instead of silently escaping every rule.
    /// </summary>
    public static IReadOnlyList<Regex> CoveredAssemblyPatterns { get; } = [Api, Connectors, Agents, Providers];

    /// <summary>
    /// Types under <c>Features</c> that sit outside <c>Features/&lt;Slice&gt;[/Commands|/Queries|/Domain]</c>. The CQRS and
    /// domain rules match those folders, so a type in any other folder would silently escape them.
    /// </summary>
    public static IReadOnlyList<string> TypesOutsideTheSliceLayout(Architecture architecture) =>
        [.. architecture.Types
            .Where(type => type.Namespace.FullName.StartsWith("Helmstead.Core.Api.Features", StringComparison.Ordinal))
            .Where(type => !SliceLayout.IsMatch(type.Namespace.FullName))
            .Select(type => type.FullName)];

    private static Func<IType, bool> InAssembly(Regex pattern) => type => pattern.IsMatch(type.Assembly.Name);

    private static Func<IType, bool> InNamespace(Regex pattern) => type => pattern.IsMatch(type.Namespace.FullName);

    private static Func<IType, string?> TargetMatches(Regex pattern) =>
        type => type.Dependencies
            .Select(dependency => dependency.Target.FullName)
            .FirstOrDefault(name => pattern.IsMatch(name));

    private static Func<IType, string?> OtherAssembly(Regex assemblyPattern) =>
        type => type.Dependencies
            .Select(dependency => dependency.Target)
            .FirstOrDefault(target => target.Assembly.FullName != type.Assembly.FullName && assemblyPattern.IsMatch(target.Assembly.Name))
            ?.FullName;

    private static string? SliceOf(IType type)
    {
        var match = Slice.Match(type.Namespace.FullName);
        return match.Success ? match.Groups["slice"].Value : null;
    }
}
