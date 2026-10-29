using Helmstead.Core.Api;
using Helmstead.Core.Api.Features.Health;
using Helmstead.Core.Api.Shared.Cqrs;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOpenApi();
builder.Services.AddHandlers(typeof(Program).Assembly);

var app = builder.Build();
LoopbackBinding.Validate(app.Configuration);
app.MapHealth();
app.Run();

// Makes the entry point visible to WebApplicationFactory in the tests.
public partial class Program;
