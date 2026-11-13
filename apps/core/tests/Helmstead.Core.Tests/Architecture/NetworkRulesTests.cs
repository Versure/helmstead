using System.Net;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Xml.Linq;
using ArchUnitNET.Domain;
using ArchUnitNET.Loader;
using Helmstead.Core.Api;
using Helmstead.Testing;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Helmstead.Core.Tests.Boundaries;

/// <summary>Spec 003 criterion 15: tests in .NET do not reach the network.</summary>
public sealed class NetworkRulesTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    // TEST-NET-1 (RFC 5737) is never routed, so even a guard that failed open would not reach a real host.
    private const string TestNet = "http://192.0.2.1/";

    private static readonly Lazy<Architecture> TestAssemblies = new(() =>
        new ArchLoader().LoadAssemblies([.. AssemblyDiscovery.Load(["Helmstead.Core.Tests", "Helmstead.Tests.NetworkFixture"])]).Build());

    // With HELMSTEAD_LIVE_TESTS=1 (live tests only, never in CI) the guard is lifted, so there is nothing to block.
    private static bool LiveTests => Environment.GetEnvironmentVariable("HELMSTEAD_LIVE_TESTS") == "1";

    [Fact]
    public void The_guard_is_installed_before_any_test_runs_unless_live_tests_are_enabled()
    {
        Assert.Equal(!LiveTests, NoNetwork.Installed);
    }

    [Fact]
    public async Task An_HttpClient_call_to_a_non_loopback_host_fails_fast_at_the_guard()
    {
        if (LiveTests)
        {
            return;
        }

        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        var started = DateTime.UtcNow;

        var error = await Assert.ThrowsAsync<HttpRequestException>(() => client.GetAsync(TestNet));

        Assert.Contains(NoNetwork.ProxyEndpoint, Describe(error), StringComparison.Ordinal);
        Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(10), "The guard should refuse at once, not time out.");
    }

    [Fact]
    public async Task A_client_from_IHttpClientFactory_is_guarded_too()
    {
        if (LiveTests)
        {
            return;
        }

        using var services = new ServiceCollection().AddHttpClient().BuildServiceProvider();
        using var client = services.GetRequiredService<IHttpClientFactory>().CreateClient();

        var error = await Assert.ThrowsAsync<HttpRequestException>(() => client.GetAsync(TestNet));

        Assert.Contains(NoNetwork.ProxyEndpoint, Describe(error), StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_in_memory_WebApplicationFactory_client_still_works()
    {
        using var client = factory.CreateClient();

        using var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task A_fake_message_handler_still_works()
    {
        using var client = new HttpClient(new FixedResponse());

        using var response = await client.GetAsync(TestNet);

        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
    }

    [Theory]
    [InlineData("127.0.0.1", true)]
    [InlineData("[::1]", true)]
    [InlineData("localhost", true)]
    [InlineData("192.0.2.1", false)]
    [InlineData("example.com", false)]
    public void Only_loopback_bypasses_the_proxy(string host, bool loopback)
    {
        Assert.Equal(loopback, NoNetwork.IsLoopback(host));
    }

    [Fact]
    public void The_real_test_code_obeys_the_rule()
    {
        var types = TestAssemblies.Value.Types.Where(type => type.Assembly.Name == "Helmstead.Core.Tests").ToArray();

        Assert.NotEmpty(types);
        foreach (var result in NetworkRules.Rule.ToArchRule().Evaluate(TestAssemblies.Value).Where(r => r.EvaluatedObject is IType t && t.Assembly.Name == "Helmstead.Core.Tests"))
        {
            Assert.True(result.Passed, result.Description);
        }
    }

    [Fact]
    public void The_rule_fails_on_the_fixture_for_every_forbidden_type_and_member()
    {
        var fixture = TestAssemblies.Value.Types.Where(type => type.Assembly.Name == "Helmstead.Tests.NetworkFixture");
        var found = fixture.SelectMany(NetworkRules.Violations).ToHashSet();

        foreach (var item in NetworkRules.ForbiddenTypes.Concat(NetworkRules.ForbiddenMembers))
        {
            Assert.True(found.Contains(item), $"The rule does not find {item} in the fixture.");
        }

        Assert.Contains(
            NetworkRules.Rule.ToArchRule().Evaluate(TestAssemblies.Value),
            result => !result.Passed && result.Description.Contains("NetworkFixtureTypes", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("LambdaSocket")]
    [InlineData("AsyncSocket")]
    public void The_rule_also_catches_code_in_lambdas_and_async_methods(string fixtureType)
    {
        var failures = NetworkRules.Rule.ToArchRule().Evaluate(TestAssemblies.Value).Where(result => !result.Passed);

        Assert.Contains(failures, failure => failure.Description.Contains(fixtureType, StringComparison.Ordinal));
    }

    [Fact]
    public void Every_test_project_in_the_solution_has_the_module_initializer()
    {
        var solution = AssemblyDiscovery.CoreDirectory();
        var testProjects = XDocument.Load(Path.Combine(solution, "Helmstead.Core.slnx"))
            .Descendants("Project")
            .Select(project => (string)project.Attribute("Path")!)
            .Where(path => path.StartsWith("tests/", StringComparison.Ordinal))
            .Select(path => Path.GetFileNameWithoutExtension(path))
            .ToArray();

        Assert.NotEmpty(testProjects);
        foreach (var name in testProjects)
        {
            Assert.EndsWith(".Tests", name, StringComparison.Ordinal);
            var guard = System.Reflection.Assembly.Load(new AssemblyName(name)).GetType("Helmstead.Testing.NoNetwork");
            Assert.True(guard is not null, $"{name} does not contain Shared/NoNetwork.cs; it must be under apps/core/tests so Directory.Build.props links it.");
            Assert.NotNull(guard!.GetMethod("Install", BindingFlags.Static | BindingFlags.NonPublic)?.GetCustomAttribute<ModuleInitializerAttribute>());
        }
    }

    private static string Describe(Exception error) =>
        error.InnerException is null ? error.Message : $"{error.Message} {Describe(error.InnerException)}";

    private sealed class FixedResponse : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.Accepted));
    }
}
