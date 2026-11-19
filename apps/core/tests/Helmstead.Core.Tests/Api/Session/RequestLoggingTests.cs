using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Helmstead.Core.Tests.Api.Session;

/// <summary>Spec 004 criterion 11: no token reaches the logs, and a refusal logs one warning with the reason and the port.</summary>
public sealed class RequestLoggingTests
{
    [Fact]
    public async Task No_token_appears_in_the_logs_at_any_level()
    {
        var capture = new CapturingLoggerProvider();
        await using var app = Start(capture);
        var presented = SessionEnvironment.NewToken();

        using (var client = app.CreateAuthorizedClient())
        {
            using var ok = await client.GetAsync("/health");
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
            using var withQuery = await client.GetAsync($"/health?token={app.Token}");
        }

        using (var client = app.CreateClient())
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", presented);
            using var wrong = await client.GetAsync("/health");
            Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
            using var wrongInQuery = await client.GetAsync($"/missing?access_token={presented}");
            using var foreignHost = new HttpRequestMessage(HttpMethod.Get, "/health");
            foreignHost.Headers.Host = "example.com";
            using var _ = await client.SendAsync(foreignHost);
        }

        var output = capture.All();
        Assert.NotEmpty(output);
        Assert.Contains(output, line => line.Contains("Microsoft.AspNetCore", StringComparison.Ordinal));
        Assert.DoesNotContain(output, line => line.Contains(app.Token, StringComparison.Ordinal));
        Assert.DoesNotContain(output, line => line.Contains(presented, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("host")]
    [InlineData("origin")]
    [InlineData("token")]
    public async Task A_refused_request_logs_one_warning_with_the_reason_and_the_remote_port(string reason)
    {
        var capture = new CapturingLoggerProvider();
        await using var app = Start(capture);
        using var client = app.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        var marker = SessionEnvironment.NewToken();
        switch (reason)
        {
            case "host":
                request.Headers.Host = "example.com";
                break;
            case "origin":
                request.Headers.TryAddWithoutValidation("Origin", $"https://{marker.ToLowerInvariant()}.example");
                break;
        }

        request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + marker);
        request.Headers.UserAgent.ParseAdd($"agent-{marker}");
        capture.Clear();

        using var response = await client.SendAsync(request);

        Assert.NotEqual(HttpStatusCode.OK, response.StatusCode);
        var warning = Assert.Single(capture.Entries, entry => entry.Level >= LogLevel.Warning);
        Assert.Equal(LogLevel.Warning, warning.Level);
        Assert.Contains(reason, warning.Message, StringComparison.Ordinal);
        Assert.Contains("remote port", warning.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(capture.All(), line => line.Contains(marker, StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(capture.All(), line => line.Contains("example.com", StringComparison.Ordinal));
    }

    private static CoreApp Start(CapturingLoggerProvider capture)
    {
        var app = new LoggingCoreApp(capture);
        _ = app.Server;
        return app;
    }

    private sealed class LoggingCoreApp(CapturingLoggerProvider capture) : CoreApp
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) =>
            builder.ConfigureLogging(logging =>
            {
                // Every level, for every category, so nothing is hidden by the app's own log settings.
                logging.SetMinimumLevel(LogLevel.Trace);
                logging.AddFilter<CapturingLoggerProvider>(null, LogLevel.Trace);
                logging.Services.AddSingleton<ILoggerProvider>(capture);
            });
    }
}

public sealed record LogEntry(string Category, LogLevel Level, string Message);

public sealed class CapturingLoggerProvider : ILoggerProvider
{
    private readonly ConcurrentQueue<LogEntry> entries = new();

    public IReadOnlyList<LogEntry> Entries => [.. entries];

    public IReadOnlyList<string> All() =>
        [.. entries.Select(entry => $"{entry.Category} {entry.Level} {entry.Message}")];

    public void Clear() => entries.Clear();

    public ILogger CreateLogger(string categoryName) => new Logger(categoryName, entries);

    public void Dispose()
    {
    }

    private sealed class Logger(string category, ConcurrentQueue<LogEntry> entries) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var message = formatter(state, exception);
            if (state is IEnumerable<KeyValuePair<string, object?>> values)
            {
                message += " " + string.Join(", ", values.Select(pair => $"{pair.Key}={pair.Value}"));
            }

            entries.Enqueue(new LogEntry(category, logLevel, message + (exception is null ? string.Empty : " " + exception)));
        }
    }
}
