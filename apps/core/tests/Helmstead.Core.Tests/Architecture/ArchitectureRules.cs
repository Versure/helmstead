using System.Text.RegularExpressions;
using ArchUnitNET.Domain;
using ArchUnitNET.Fluent;
using ArchUnitNET.Fluent.Conditions;
using static ArchUnitNET.Fluent.ArchRuleDefinition;

namespace Helmstead.Core.Tests.Boundaries;

/// <summary>One layer rule: types in assemblies matching <see cref="Subject"/> must not depend on <see cref="Forbidden"/>.</summary>
public sealed record LayerRule(string Name, string Why, Regex Subject, Func<IType, IType, bool> Forbidden)
{
    public IArchRule ToArchRule() =>
        Types().That().FollowCustomPredicate(type => Subject.IsMatch(type.Assembly.Name), $"reside in an assembly matching {Subject}")
            .Should().FollowCustomCondition(
                type =>
                {
                    var violation = type.Dependencies
                        .Select(dependency => dependency.Target)
                        .FirstOrDefault(target => Forbidden(type, target));
                    return violation is null
                        ? new ConditionResult(type, true)
                        : new ConditionResult(type, false, $"depends on {violation.FullName}");
                },
                Why)
            .Because(Why)
            // Rules also cover projects that do not exist yet; the negative tests prove they can still fail.
            .WithoutRequiringPositiveResults();

    public override string ToString() => Name;
}

/// <summary>
/// The .NET layer rules of ADR-002. They match assemblies by name pattern, so projects added later are covered.
/// Bounded-context rules are added by the specs that create those modules.
/// </summary>
public static class ArchitectureRules
{
    private static readonly Regex Domain = new(@"^Helmstead\.Core\.Domain(\.|$)");
    private static readonly Regex Persistence = new(@"^Helmstead\.Core\.Persistence(\.|$)");
    private static readonly Regex Api = new(@"^Helmstead\.Core\.Api(\.|$)");
    private static readonly Regex Connectors = new(@"^Helmstead\.Connectors\.");
    private static readonly Regex Agents = new(@"^Helmstead\.Agents(\.|$)");
    private static readonly Regex Providers = new(@"^Helmstead\.Providers(\.|$)");
    private static readonly Regex AnyHelmstead = new(@"^Helmstead\.");
    private static readonly Regex NotApi = new(@"^Helmstead\.(?!Core\.Api(\.|$))");

    private static readonly Regex AspNetCore = new(@"^Microsoft\.AspNetCore\.");
    private static readonly Regex EfCore = new(@"^Microsoft\.EntityFrameworkCore(\.|$)");
    private static readonly Regex Http = new(@"^System\.Net\.Http(\.|$)");

    public static IReadOnlyList<LayerRule> All { get; } =
    [
        new("Domain references no other Helmstead assembly",
            "Domain depends on nothing (plan §2, ADR-002).",
            Domain,
            (type, target) => InOtherAssembly(type, target, AnyHelmstead)),
        new("Domain references no ASP.NET Core",
            "Domain stays free of web concerns.",
            Domain,
            (_, target) => AspNetCore.IsMatch(target.FullName)),
        new("Domain references no EF Core",
            "Domain stays free of storage concerns.",
            Domain,
            (_, target) => EfCore.IsMatch(target.FullName)),
        new("Domain references no System.Net.Http",
            "Domain does not talk to the network.",
            Domain,
            (_, target) => Http.IsMatch(target.FullName)),
        new("Persistence does not reference Api",
            "Dependencies point from Api to Persistence, never back.",
            Persistence,
            (type, target) => InOtherAssembly(type, target, Api)),
        new("Only Api references ASP.NET Core",
            "Web concerns live in Helmstead.Core.Api only.",
            NotApi,
            (_, target) => AspNetCore.IsMatch(target.FullName)),
        new("A connector references no other connector, Agents or Providers",
            "No connector-specific code outside its adapter (plan §10 rule 5).",
            Connectors,
            (type, target) => InOtherAssembly(type, target, Connectors)
                              || InOtherAssembly(type, target, Agents)
                              || InOtherAssembly(type, target, Providers)),
        new("Agents references no connector",
            "Harness and connector stay separate (plan §2 principle 1).",
            Agents,
            (type, target) => InOtherAssembly(type, target, Connectors)),
        new("Providers references no connector and no Agents",
            "Model providers know neither connectors nor harnesses.",
            Providers,
            (type, target) => InOtherAssembly(type, target, Connectors) || InOtherAssembly(type, target, Agents)),
    ];

    private static bool InOtherAssembly(IType from, IType to, Regex assemblyPattern) =>
        to.Assembly.FullName != from.Assembly.FullName && assemblyPattern.IsMatch(to.Assembly.Name);
}
