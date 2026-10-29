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
                "A connector references no other connector, Agents or Providers",
                "Agents references no connector",
                "Providers references no connector and no Agents",
            ],
            ArchitectureRules.All.Select(rule => rule.Name));
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
    public void The_rule_fails_on_a_deliberately_violating_fixture(string name)
    {
        var results = Rule(name).ToArchRule().Evaluate(Fixtures.Value).ToArray();

        Assert.Contains(results, result => !result.Passed);
    }
}
