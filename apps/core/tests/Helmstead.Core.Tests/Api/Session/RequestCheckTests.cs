using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Helmstead.Core.Tests.Api.Session;

/// <summary>Spec 004 criteria 4 to 9: every request is checked for host, origin and token, in that order.</summary>
public sealed class RequestCheckTests(CoreApp app) : IClassFixture<CoreApp>
{
    public static TheoryData<string> MissingOrWrongTokens() =>
        ["no header", "another scheme", "a different token", "a token of another length", "an empty bearer", "the scheme only", "two headers"];

    [Theory]
    [MemberData(nameof(MissingOrWrongTokens))]
    public async Task A_request_without_the_right_token_gets_a_401_that_does_not_say_why(string what)
    {
        using var client = app.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        var other = SessionEnvironment.NewToken();
        switch (what)
        {
            case "another scheme":
                request.Headers.TryAddWithoutValidation("Authorization", "Basic " + app.Token);
                break;
            case "a different token":
                request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + other);
                break;
            case "a token of another length":
                request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + app.Token + "A");
                break;
            case "an empty bearer":
                request.Headers.TryAddWithoutValidation("Authorization", "Bearer ");
                break;
            case "the scheme only":
                request.Headers.TryAddWithoutValidation("Authorization", "Bearer");
                break;
            case "two headers":
                request.Headers.TryAddWithoutValidation("Authorization", ["Bearer " + app.Token, "Bearer " + other]);
                break;
        }

        using var response = await client.SendAsync(request);

        await AssertUnauthorized(response);
    }

    [Fact]
    public async Task Every_401_has_the_same_body()
    {
        using var client = app.CreateClient();
        using var missing = await client.GetAsync("/health");
        using var wrong = new HttpRequestMessage(HttpMethod.Get, "/health");
        wrong.Headers.Authorization = new AuthenticationHeaderValue("Bearer", SessionEnvironment.NewToken());
        using var wrongResponse = await client.SendAsync(wrong);

        Assert.Equal(await missing.Content.ReadAsStringAsync(), await wrongResponse.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task The_right_token_reaches_the_endpoint()
    {
        using var client = app.CreateAuthorizedClient();

        using var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task The_scheme_is_case_insensitive()
    {
        using var client = app.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.TryAddWithoutValidation("Authorization", "bearer " + app.Token);

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("/does-not-exist")]
    [InlineData("/health/extra")]
    [InlineData("/openapi/v1.json")]
    public async Task A_path_that_does_not_exist_gets_401_not_404_without_a_token(string path)
    {
        using var client = app.CreateClient();

        using var response = await client.GetAsync(path);

        await AssertUnauthorized(response);
    }

    [Theory]
    [InlineData("query string")]
    [InlineData("cookie")]
    [InlineData("X-Session-Token header")]
    [InlineData("X-Authorization header")]
    [InlineData("Proxy-Authorization header")]
    public async Task A_token_sent_any_other_way_counts_as_no_token(string how)
    {
        using var client = app.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, how == "query string" ? $"/health?access_token={app.Token}&token={app.Token}" : "/health");
        switch (how)
        {
            case "cookie":
                request.Headers.Add("Cookie", $"access_token={app.Token}; token={app.Token}");
                break;
            case "query string":
                break;
            default:
                request.Headers.TryAddWithoutValidation(how.Split(' ')[0], "Bearer " + app.Token);
                break;
        }

        using var response = await client.SendAsync(request);

        await AssertUnauthorized(response);
    }

    [Theory]
    [InlineData("example.com:5108")]
    [InlineData("localhost:5108")]
    [InlineData("127.0.0.1.nip.io:5108")]
    [InlineData("127.0.0.1:5109")]
    [InlineData("127.0.0.1")]
    [InlineData("127.1:5108")]
    [InlineData("[::ffff:127.0.0.1]:5108")]
    [InlineData("192.168.1.20:5108")]
    public async Task A_foreign_host_gets_403_with_or_without_a_token(string host)
    {
        foreach (var authorized in new[] { false, true })
        {
            using var client = authorized ? app.CreateAuthorizedClient() : app.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
            request.Headers.Host = host;

            using var response = await client.SendAsync(request);

            await AssertForbidden(response);
        }
    }

    [Theory]
    [InlineData("127.0.0.1:5108")]
    [InlineData("[::1]:5108")]
    public async Task A_loopback_literal_with_a_listening_port_is_accepted(string host)
    {
        using var client = app.CreateAuthorizedClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Host = host;

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("https://example.com")]
    [InlineData("http://127.0.0.1:4200")]
    [InlineData("http://127.0.0.1:5108")]
    [InlineData("null")]
    public async Task A_request_with_an_origin_gets_403_with_or_without_a_token(string origin)
    {
        foreach (var authorized in new[] { false, true })
        {
            using var client = authorized ? app.CreateAuthorizedClient() : app.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
            request.Headers.TryAddWithoutValidation("Origin", origin);

            using var response = await client.SendAsync(request);

            await AssertForbidden(response);
        }
    }

    [Fact]
    public async Task A_preflight_gets_403_and_no_CORS_header()
    {
        using var client = app.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/health");
        request.Headers.TryAddWithoutValidation("Origin", "https://example.com");
        request.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "GET");
        request.Headers.TryAddWithoutValidation("Access-Control-Request-Headers", "authorization");

        using var response = await client.SendAsync(request);

        await AssertForbidden(response);
    }

    [Fact]
    public async Task A_request_without_an_origin_is_not_refused_for_its_origin()
    {
        using var client = app.CreateAuthorizedClient();

        using var response = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertNoCorsHeaders(response);
    }

    [Fact]
    public async Task The_host_is_checked_before_the_origin_and_the_origin_before_the_token()
    {
        using var client = app.CreateClient();

        using var both = new HttpRequestMessage(HttpMethod.Get, "/health");
        both.Headers.Host = "example.com";
        both.Headers.TryAddWithoutValidation("Origin", "https://example.com");
        using var hostFirst = await client.SendAsync(both);

        using var originAndToken = new HttpRequestMessage(HttpMethod.Get, "/health");
        originAndToken.Headers.TryAddWithoutValidation("Origin", "https://example.com");
        using var originFirst = await client.SendAsync(originAndToken);

        await AssertForbidden(hostFirst);
        Assert.False(hostFirst.Headers.Contains("WWW-Authenticate"));
        await AssertForbidden(originFirst);
        Assert.False(originFirst.Headers.Contains("WWW-Authenticate"));
    }

    internal static async Task AssertUnauthorized(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("Bearer", Assert.Single(response.Headers.WwwAuthenticate).ToString());
        await AssertProblem(response, 401);
    }

    internal static async Task AssertForbidden(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        await AssertProblem(response, 403);
    }

    private static async Task AssertProblem(HttpResponseMessage response, int status)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(status, json.RootElement.GetProperty("status").GetInt32());
        Assert.Equal(["status", "title", "type"], json.RootElement.EnumerateObject().Select(p => p.Name).Order().ToArray());
        AssertNoCorsHeaders(response);
    }

    private static void AssertNoCorsHeaders(HttpResponseMessage response) =>
        Assert.DoesNotContain(
            response.Headers.Select(h => h.Key).Concat(response.Content.Headers.Select(h => h.Key)),
            name => name.StartsWith("Access-Control-", StringComparison.OrdinalIgnoreCase));
}
