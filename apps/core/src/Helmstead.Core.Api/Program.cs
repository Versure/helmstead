using Helmstead.Core.Api;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOpenApi();

var app = builder.Build();
LoopbackBinding.Validate(app.Configuration);
app.MapHealth();
app.Run();

// Makes the entry point visible to WebApplicationFactory in the tests.
public partial class Program;
