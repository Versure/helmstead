using Helmstead.Core.Api;
using Helmstead.Core.Api.Features.Health;
using Helmstead.Core.Api.Shared.Cqrs;
using Helmstead.Core.Api.Shared.Session;

// First, before CreateBuilder copies the environment into the configuration: read the session token and remove it
// from the environment (spec 004). Startup stops here without a valid one.
var sessionToken = SessionToken.ForThisProcess();

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSessionChecks(sessionToken);
builder.Services.AddOpenApi(options => options.AddSessionToken());
builder.Services.AddHandlers(typeof(Program).Assembly);

var app = builder.Build();
LoopbackBinding.Validate(app.Configuration);
app.MapHealth();
app.Run();

// Makes the entry point visible to WebApplicationFactory in the tests.
public partial class Program;
