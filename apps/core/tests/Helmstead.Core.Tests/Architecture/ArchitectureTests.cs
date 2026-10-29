using ArchUnitNET.Domain;
using ArchUnitNET.Loader;

namespace Helmstead.Core.Tests.Boundaries;

public sealed class ArchitectureTests
{
    private static readonly Lazy<Architecture> Real = new(() => Load(AssemblyDiscovery.RealAssemblyNames(AssemblyDiscovery.NamesInOutputFolder())));

    // The Persistence fixture depends on the real Api assembly, so that one is loaded next to the fixtures
    // for the dependency to resolve to a named assembly. Nothing else of the real code is loaded.
    private static readonly Lazy<Architecture> Fixtures = new(() =>
        Load([.. AssemblyDiscovery.FixtureAssemblyNames(AssemblyDiscovery.NamesInOutputFolder()), "Helmstead.Core.Api"]));

    // Each rule, with the dependency the fixtures contain for it. A rule that stops looking for that
    // dependency (a clause deleted from a predicate) fails here even though another clause still fires.
    private static readonly Dictionary<string, string> ExpectedViolation = new()
    {
        ["Domain references no other Helmstead assembly"] = "Helmstead.Connectors.FixtureB.FixtureBType",
        ["Domain references no ASP.NET Core"] = "Microsoft.AspNetCore.Http.HttpContext",
        ["Domain references no EF Core"] = "Microsoft.EntityFrameworkCore.FixtureDbContext",
        ["Domain references no System.Net.Http"] = "System.Net.Http.HttpClient",
        ["Persistence does not reference Api"] = "Helmstead.Core.Api.HealthResponse",
        ["Only Api references ASP.NET Core"] = "Microsoft.AspNetCore.Http.HttpContext",
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
                "Domain references no other Helmstead assembly",
                "Domain references no ASP.NET Core",
                "Domain references no EF Core",
                "Domain references no System.Net.Http",
                "Persistence does not reference Api",
                "Only Api references ASP.NET Core",
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
        Assert.Contains("Helmstead.Core.Domain", names);
        Assert.Contains("Helmstead.Core.Persistence", names);
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
