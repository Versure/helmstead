using ArchUnitNET.Domain;
using ArchUnitNET.Loader;

namespace Helmstead.Core.Tests.Boundaries;

public sealed class ArchitectureTests
{
    private static readonly Lazy<Architecture> Real = new(() => Load(AssemblyDiscovery.RealAssemblyNames(AssemblyDiscovery.NamesInOutputFolder())));

    private static readonly Lazy<Architecture> Fixtures = new(() =>
        Load(AssemblyDiscovery.FixtureAssemblyNames(AssemblyDiscovery.NamesInOutputFolder())));

    // Each rule, with the dependency the fixtures contain for it. A rule that stops looking for that
    // dependency (a clause deleted from a predicate) fails here even though another clause still fires.
    private static readonly Dictionary<string, string> ExpectedViolation = new()
    {
        ["Domain code references no ASP.NET Core"] = "Microsoft.AspNetCore.Http.HttpContext",
        ["Domain code references no EF Core"] = "Microsoft.EntityFrameworkCore.FixtureDbContext",
        ["Domain code references no System.Net.Http"] = "System.Net.Http.HttpClient",
        ["Only Api references ASP.NET Core"] = "Microsoft.AspNetCore.Http.HttpContext",
        ["A slice references no other slice"] = "Helmstead.Core.Api.Features.Billing.Invoice",
        ["The shared kernel references no slice"] = "Helmstead.Core.Api.Features.Billing.Invoice",
        ["Queries reference no commands"] = "Helmstead.Core.Api.Features.Orders.Commands.PlaceOrder",
        ["Commands reference no queries"] = "Helmstead.Core.Api.Features.Orders.Queries.ListOrders",
        ["Queries never write"] = "SaveChangesAsync",
        ["A connector references no other connector"] = "Helmstead.Connectors.FixtureB.FixtureBType",
        ["A connector references no Agents"] = "Helmstead.Agents.Fixture.AgentFixtureType",
        ["A connector references no Providers"] = "Helmstead.Providers.Fixture.ProviderFixtureType",
        ["Agents references no connector"] = "Helmstead.Connectors.FixtureB.FixtureBType",
        ["Providers references no connector"] = "Helmstead.Connectors.FixtureB.FixtureBType",
        ["Providers references no Agents"] = "Helmstead.Agents.Fixture.AgentFixtureType",
    };

    public static TheoryData<string> RuleNames => [.. ArchitectureRules.All.Select(rule => rule.Name)];

    private static Architecture Load(IReadOnlyList<string> assemblyNames) =>
        new ArchLoader().LoadAssemblies([.. AssemblyDiscovery.Load(assemblyNames)]).Build();

    private static LayerRule Rule(string name) => ArchitectureRules.All.Single(rule => rule.Name == name);

    [Fact]
    public void The_rule_set_is_the_one_in_the_spec()
    {
        Assert.Equal(
            [
                "Domain code references no ASP.NET Core",
                "Domain code references no EF Core",
                "Domain code references no System.Net.Http",
                "Only Api references ASP.NET Core",
                "A slice references no other slice",
                "The shared kernel references no slice",
                "Queries reference no commands",
                "Commands reference no queries",
                "Queries never write",
                "A connector references no other connector",
                "A connector references no Agents",
                "A connector references no Providers",
                "Agents references no connector",
                "Providers references no connector",
                "Providers references no Agents",
            ],
            ArchitectureRules.All.Select(rule => rule.Name));
        Assert.Equal(ArchitectureRules.All.Select(rule => rule.Name).Order(), ExpectedViolation.Keys.Order());
    }

    [Fact]
    public void The_real_assemblies_are_loaded_and_include_the_known_projects()
    {
        var names = Real.Value.Assemblies.Select(assembly => assembly.Name).ToArray();

        Assert.Contains("Helmstead.Core.Api", names);
        Assert.DoesNotContain(names, name => name.Contains("Fixture", StringComparison.Ordinal));
    }

    [Fact]
    public void Every_project_under_src_is_scanned_and_matches_a_rule_pattern()
    {
        var projects = AssemblyDiscovery.SourceProjectNames();
        var scanned = AssemblyDiscovery.RealAssemblyNames(AssemblyDiscovery.NamesInOutputFolder());

        Assert.NotEmpty(projects);
        foreach (var project in projects)
        {
            // A real project must not leave the scan (for example by having "Fixture" in its name)...
            Assert.Contains(project, scanned);
            // ...and its name must be one the rules know, so a misnamed project fails here instead of escaping the rules.
            Assert.True(
                ArchitectureRules.CoveredAssemblyPatterns.Any(pattern => pattern.IsMatch(project)),
                $"'{project}' matches no assembly pattern of the architecture rules. Name it after a known layer, or add its rules in ArchitectureRules.cs.");
        }
    }

    [Theory]
    [MemberData(nameof(RuleNames))]
    public void The_real_code_obeys_the_rule(string name)
    {
        foreach (var result in Rule(name).ToArchRule().Evaluate(Real.Value))
        {
            Assert.True(result.Passed, result.Description);
        }
    }

    [Theory]
    [MemberData(nameof(RuleNames))]
    public void The_rule_fails_on_a_deliberately_violating_fixture_for_the_right_reason(string name)
    {
        var failures = Rule(name).ToArchRule().Evaluate(Fixtures.Value).Where(result => !result.Passed).ToArray();

        Assert.NotEmpty(failures);
        Assert.Contains(failures, failure => failure.Description.Contains(ExpectedViolation[name], StringComparison.Ordinal));
    }
}
