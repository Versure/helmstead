using Helmstead.Core.Api;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Helmstead.Core.Tests.Api;

public sealed class LoopbackBindingTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    [Theory]
    [InlineData("http://127.0.0.1:5108")]
    [InlineData("http://127.0.0.1:0")]
    [InlineData("http://127.0.0.1:5108;http://[::1]:5109")]
    public void Loopback_addresses_are_accepted(string urls)
    {
        LoopbackBinding.Validate(urls.Split(';'));
    }

    [Theory]
    [InlineData("http://0.0.0.0:5108")]
    [InlineData("http://*:5108")]
    [InlineData("http://+:5108")]
    [InlineData("http://[::]:5108")]
    [InlineData("http://192.168.1.20:5108")]
    [InlineData("http://example.com:5108")]
    [InlineData("http://localhost:5108")]
    [InlineData("http://127.0.0.1:5108;http://0.0.0.0:5109")]
    public void Non_loopback_addresses_are_rejected_with_a_clear_message(string urls)
    {
        var error = Assert.Throws<InvalidOperationException>(() => LoopbackBinding.Validate(urls.Split(';')));

        Assert.Contains("loopback", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("127.0.0.1", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void No_configured_address_is_rejected()
    {
        var error = Assert.Throws<InvalidOperationException>(() => LoopbackBinding.Validate([]));

        Assert.Contains("127.0.0.1", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Startup_fails_when_configuration_binds_to_a_non_loopback_address()
    {
        var unsafeFactory = factory.WithWebHostBuilder(builder => builder.UseSetting("urls", "http://0.0.0.0:5108"));

        var error = Assert.ThrowsAny<InvalidOperationException>(() => unsafeFactory.CreateClient());

        Assert.Contains("loopback", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Default_configuration_binds_to_a_loopback_address_only()
    {
        var configuration = factory.Services.GetRequiredService<IConfiguration>();

        var urls = LoopbackBinding.ConfiguredUrls(configuration).ToArray();

        Assert.NotEmpty(urls);
        Assert.All(urls, url => Assert.StartsWith("http://127.0.0.1:", url, StringComparison.Ordinal));
        LoopbackBinding.Validate(urls);
    }
}
