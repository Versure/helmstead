namespace Helmstead.Core.Tests.Boundaries;

public sealed class AssemblyDiscoveryTests
{
    private static readonly string[] Output =
    [
        "Helmstead.Core.Api",
        "Helmstead.Core.Domain",
        "Helmstead.Core.Persistence",
        "Helmstead.Connectors.GitLab",
        "Helmstead.Agents",
        "Helmstead.Providers",
        "Helmstead.Memory",
        "Helmstead.Core.Tests",
        "Helmstead.Connectors.FixtureA",
        "Helmstead.Core.Domain.Fixture",
        "Microsoft.AspNetCore.Mvc.Testing",
        "xunit.core",
        "ArchUnitNET",
    ];

    [Fact]
    public void Real_assemblies_are_found_by_name_pattern_including_ones_added_later()
    {
        var real = AssemblyDiscovery.RealAssemblyNames(Output);

        Assert.Equal(
            [
                "Helmstead.Agents",
                "Helmstead.Connectors.GitLab",
                "Helmstead.Core.Api",
                "Helmstead.Core.Domain",
                "Helmstead.Core.Persistence",
                "Helmstead.Memory",
                "Helmstead.Providers",
            ],
            real.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Fixtures_and_the_test_assembly_are_never_scanned_as_real_code()
    {
        var real = AssemblyDiscovery.RealAssemblyNames(Output);

        Assert.DoesNotContain(real, name => name.Contains("Fixture", StringComparison.Ordinal));
        Assert.DoesNotContain("Helmstead.Core.Tests", real);
    }

    [Fact]
    public void Fixture_assemblies_are_found_separately()
    {
        var fixtures = AssemblyDiscovery.FixtureAssemblyNames(Output);

        Assert.Equal(["Helmstead.Connectors.FixtureA", "Helmstead.Core.Domain.Fixture"], fixtures.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void A_new_project_under_a_known_pattern_is_covered_without_editing_the_tests()
    {
        string[] withNewConnector = [.. Output, "Helmstead.Connectors.Jira"];

        Assert.Contains("Helmstead.Connectors.Jira", AssemblyDiscovery.RealAssemblyNames(withNewConnector));
    }
}
