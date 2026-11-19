using Helmstead.Core.Api.Shared.Session;

namespace Helmstead.Core.Tests.Api.Session;

/// <summary>Spec 004 criteria 2, 3 and 4: reading, validating and comparing the session token.</summary>
public sealed class SessionTokenTests
{
    public static TheoryData<string, string?> InvalidValues()
    {
        var valid = SessionEnvironment.NewToken();
        return new()
        {
            { "missing", null },
            { "empty", string.Empty },
            { "42 characters", valid[..42] },
            { "base64 with padding", valid + "=" },
            { "a plus sign", valid[..42] + "+" },
            { "a slash", valid[..42] + "/" },
            { "a space", valid + " " },
            { "a non-ASCII letter", valid[..42] + "é" },
        };
    }

    [Theory]
    [MemberData(nameof(InvalidValues))]
    public void An_invalid_variable_fails_with_a_message_that_names_the_rule_and_not_the_value(string what, string? value)
    {
        var error = ReadWith(value);

        Assert.True(error is InvalidOperationException, $"{what}: expected startup to fail.");
        Assert.Contains(SessionEnvironment.Variable, error!.Message, StringComparison.Ordinal);
        Assert.Contains("43", error.Message, StringComparison.Ordinal);
        Assert.Contains("A-Z a-z 0-9 - _", error.Message, StringComparison.Ordinal);
        if (!string.IsNullOrEmpty(value))
        {
            Assert.DoesNotContain(value, error.Message, StringComparison.Ordinal);
            Assert.DoesNotContain(value.Trim()[..20], error.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void A_valid_token_is_read_and_removed_from_the_process_environment()
    {
        var value = SessionEnvironment.NewToken();
        lock (SessionEnvironment.Gate)
        {
            Environment.SetEnvironmentVariable(SessionEnvironment.Variable, value);
            try
            {
                var token = SessionToken.FromEnvironment();

                Assert.True(token.Matches(value));
                Assert.Null(Environment.GetEnvironmentVariable(SessionEnvironment.Variable));
                Assert.DoesNotContain(SessionEnvironment.Variable, Environment.GetEnvironmentVariables().Keys.Cast<string>());
            }
            finally
            {
                Environment.SetEnvironmentVariable(SessionEnvironment.Variable, null);
            }
        }
    }

    [Fact]
    public void An_invalid_token_is_removed_from_the_process_environment_too()
    {
        lock (SessionEnvironment.Gate)
        {
            Environment.SetEnvironmentVariable(SessionEnvironment.Variable, "short");
            try
            {
                Assert.Throws<InvalidOperationException>(SessionToken.FromEnvironment);
                Assert.Null(Environment.GetEnvironmentVariable(SessionEnvironment.Variable));
            }
            finally
            {
                Environment.SetEnvironmentVariable(SessionEnvironment.Variable, null);
            }
        }
    }

    [Fact]
    public void A_longer_token_is_accepted()
    {
        var value = SessionEnvironment.Base64Url(System.Security.Cryptography.RandomNumberGenerator.GetBytes(64));

        Assert.Null(ReadWith(value));
    }

    [Fact]
    public void The_token_never_shows_its_value_as_text()
    {
        var value = SessionEnvironment.NewToken();

        var token = SessionToken.Parse(value);

        Assert.DoesNotContain(value, token.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public void The_comparer_accepts_the_same_token()
    {
        var value = SessionEnvironment.NewToken();

        Assert.True(SessionToken.Parse(value).Matches(new string(value.AsSpan())));
    }

    [Fact]
    public void The_comparer_refuses_a_different_token_of_the_same_length()
    {
        var value = SessionEnvironment.NewToken();
        var other = (value[0] == 'A' ? "B" : "A") + value[1..];

        Assert.False(SessionToken.Parse(value).Matches(other));
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(1)]
    [InlineData(-43)]
    public void The_comparer_refuses_a_token_of_a_different_length(int difference)
    {
        var value = SessionEnvironment.NewToken();
        var other = difference < 0 ? value[..(value.Length + difference)] : value + new string('A', difference);

        Assert.False(SessionToken.Parse(value).Matches(other));
    }

    [Fact]
    public void The_comparer_refuses_nothing()
    {
        Assert.False(SessionToken.Parse(SessionEnvironment.NewToken()).Matches(null));
    }

    private static Exception? ReadWith(string? value)
    {
        lock (SessionEnvironment.Gate)
        {
            Environment.SetEnvironmentVariable(SessionEnvironment.Variable, value);
            try
            {
                SessionToken.FromEnvironment();
                return null;
            }
            catch (Exception error)
            {
                return error;
            }
            finally
            {
                Environment.SetEnvironmentVariable(SessionEnvironment.Variable, null);
            }
        }
    }
}
