using System.Diagnostics;
using System.Net;
using Helmstead.Core.Api.Shared.Session;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Helmstead.Core.Tests.Api.Session;

/// <summary>Spec 004 criteria 1, 2 and 3: the core starts only with a valid token from its own environment variable.</summary>
public sealed class SessionStartupTests
{
    [Fact]
    public async Task The_core_starts_with_a_valid_token_and_removes_the_variable()
    {
        await using var app = new CoreApp();
        using var client = app.CreateAuthorizedClient();

        using var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Null(app.VariableAfterStartup);
    }

    [Fact]
    public async Task The_token_is_not_in_the_configuration()
    {
        await using var app = new CoreApp();
        _ = app.Server;

        var configuration = app.Services.GetRequiredService<IConfiguration>();

        Assert.Null(configuration[SessionEnvironment.Variable]);
        Assert.DoesNotContain(configuration.AsEnumerable(), pair => pair.Value?.Contains(app.Token, StringComparison.Ordinal) == true);
    }

    [Fact]
    public async Task The_token_registered_in_the_services_is_the_one_from_the_environment()
    {
        await using var app = new CoreApp();
        _ = app.Server;

        Assert.True(app.Services.GetRequiredService<SessionToken>().Matches(app.Token));
    }

    public static TheoryData<string> OtherSources() => ["host setting", "app configuration", "ASPNETCORE_ variable", "DOTNET_ variable"];

    [Theory]
    [MemberData(nameof(OtherSources))]
    public void A_token_from_any_other_configuration_source_is_ignored_and_startup_fails(string source)
    {
        var token = SessionEnvironment.NewToken();
        var error = StartWithout(builder =>
        {
            switch (source)
            {
                case "host setting":
                    builder.UseSetting(SessionEnvironment.Variable, token);
                    break;
                case "app configuration":
                    builder.ConfigureAppConfiguration(config =>
                        config.AddInMemoryCollection([new(SessionEnvironment.Variable, token)]));
                    break;
            }
        }, source switch
        {
            "ASPNETCORE_ variable" => "ASPNETCORE_" + SessionEnvironment.Variable,
            "DOTNET_ variable" => "DOTNET_" + SessionEnvironment.Variable,
            _ => null,
        }, token);

        Assert.Contains(SessionEnvironment.Variable, error, StringComparison.Ordinal);
        Assert.DoesNotContain(token, error, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("too short")]
    [InlineData("not base64url")]
    public void Startup_fails_for_an_invalid_variable_without_showing_the_value(string what)
    {
        var token = SessionEnvironment.NewToken();
        var value = what switch
        {
            "too short" => token[..42],
            "not base64url" => token[..42] + "!",
            _ => null,
        };

        var error = StartWithout(_ => { }, value is null ? null : SessionEnvironment.Variable, value);

        Assert.Contains(SessionEnvironment.Variable, error, StringComparison.Ordinal);
        Assert.Contains("43", error, StringComparison.Ordinal);
        if (value is not null)
        {
            Assert.DoesNotContain(value, error, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task A_token_on_the_command_line_is_ignored_and_the_process_exits_with_the_rule()
    {
        var token = SessionEnvironment.NewToken();
        var core = Path.Combine(AppContext.BaseDirectory, "Helmstead.Core.Api.dll");
        var start = new ProcessStartInfo("dotnet")
        {
            ArgumentList = { core, $"--{SessionEnvironment.Variable}={token}", "/" + SessionEnvironment.Variable, token },
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            WorkingDirectory = AppContext.BaseDirectory,
        };
        start.Environment.Remove(SessionEnvironment.Variable);
        // An unused loopback port, in case the check were missing: the process must not take 5108 from a dev core.
        start.Environment["ASPNETCORE_URLS"] = "http://127.0.0.1:0";

        using var process = Process.Start(start)!;
        var stderr = process.StandardError.ReadToEndAsync();
        var stdout = process.StandardOutput.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            Assert.Fail("The core started although HELMSTEAD_SESSION_TOKEN was not set.");
        }

        var output = await stderr + await stdout;
        Assert.NotEqual(0, process.ExitCode);
        Assert.Contains(SessionEnvironment.Variable, output, StringComparison.Ordinal);
        Assert.DoesNotContain(token, output, StringComparison.Ordinal);
    }

    /// <summary>Starts the core with <paramref name="variable"/> set to <paramref name="value"/> and the session variable unset; returns the error.</summary>
    private static string StartWithout(Action<IWebHostBuilder> configure, string? variable, string? value)
    {
        lock (SessionEnvironment.Gate)
        {
            Environment.SetEnvironmentVariable(SessionEnvironment.Variable, null);
            if (variable is not null)
            {
                Environment.SetEnvironmentVariable(variable, value);
            }

            try
            {
                using var app = new WebApplicationFactory<Program>().WithWebHostBuilder(configure);
                var error = Assert.ThrowsAny<Exception>(() => app.Server);
                return Describe(error);
            }
            finally
            {
                if (variable is not null)
                {
                    Environment.SetEnvironmentVariable(variable, null);
                }
            }
        }
    }

    private static string Describe(Exception error) =>
        error.InnerException is null ? error.Message : $"{error.Message} {Describe(error.InnerException)}";
}
