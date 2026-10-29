using System.Reflection;

namespace Helmstead.Core.Tests.Boundaries;

/// <summary>
/// Finds the assemblies the architecture rules apply to by name pattern, not from a hard-coded list,
/// so a project added later under <c>Helmstead.*</c> is covered without editing the tests.
/// </summary>
public static class AssemblyDiscovery
{
    private const string TestAssembly = "Helmstead.Core.Tests";

    public static IReadOnlyList<string> RealAssemblyNames(IEnumerable<string> names) =>
        [.. names.Where(IsHelmstead).Where(n => n != TestAssembly && !IsFixture(n)).Distinct()];

    public static IReadOnlyList<string> FixtureAssemblyNames(IEnumerable<string> names) =>
        [.. names.Where(IsHelmstead).Where(IsFixture).Distinct()];

    public static IReadOnlyList<string> NamesInOutputFolder() =>
        [.. Directory.EnumerateFiles(AppContext.BaseDirectory, "Helmstead.*.dll").Select(Path.GetFileNameWithoutExtension).OfType<string>()];

    /// <summary>The project folders under <c>apps/core/src</c>, found from the solution file upwards from the test output.</summary>
    public static IReadOnlyList<string> SourceProjectNames()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "Helmstead.Core.slnx")))
            {
                return [.. Directory.EnumerateFiles(Path.Combine(directory.FullName, "src"), "*.csproj", SearchOption.AllDirectories)
                    .Select(Path.GetFileNameWithoutExtension).OfType<string>()];
            }
        }

        throw new InvalidOperationException("Helmstead.Core.slnx was not found above the test output folder.");
    }

    public static IReadOnlyList<Assembly> Load(IEnumerable<string> names) =>
        [.. names.Select(name => Assembly.Load(new AssemblyName(name)))];

    private static bool IsHelmstead(string name) => name.StartsWith("Helmstead.", StringComparison.Ordinal);

    private static bool IsFixture(string name) => name.Contains("Fixture", StringComparison.Ordinal);
}
