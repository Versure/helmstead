using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace Helmstead.Core.Api.Shared.Session;

/// <summary>
/// Writes the session checks into the API contract (spec 004 criterion 13): an HTTP bearer scheme required by every
/// operation, and the 401 problem response every operation can give. Applied to the whole document, so an endpoint
/// added later carries both without declaring anything.
/// </summary>
public static class SessionOpenApi
{
    public const string SchemeName = "SessionToken";
    private const string ProblemSchema = "ProblemDetails";

    public static OpenApiOptions AddSessionToken(this OpenApiOptions options) =>
        options.AddDocumentTransformer((document, _, _) =>
        {
            document.AddComponent(SchemeName, new OpenApiSecurityScheme
            {
                Type = SecuritySchemeType.Http,
                Scheme = "bearer",
                Description = "The session token the shell created for this run of the core, as `Authorization: Bearer <token>`.",
            });
            document.AddComponent(ProblemSchema, new OpenApiSchema
            {
                Type = JsonSchemaType.Object,
                Required = new HashSet<string> { "type", "title", "status" },
                Properties = new Dictionary<string, IOpenApiSchema>
                {
                    ["type"] = new OpenApiSchema { Type = JsonSchemaType.String },
                    ["title"] = new OpenApiSchema { Type = JsonSchemaType.String },
                    ["status"] = new OpenApiSchema { Type = JsonSchemaType.Integer, Format = "int32" },
                },
            });

            foreach (var operation in (document.Paths ?? []).Values.SelectMany(path => path.Operations?.Values.AsEnumerable() ?? []))
            {
                operation.Security ??= [];
                operation.Security.Add(new OpenApiSecurityRequirement { [new OpenApiSecuritySchemeReference(SchemeName, document)] = [] });
                operation.Responses ??= [];
                operation.Responses["401"] = new OpenApiResponse
                {
                    Description = "The request did not carry the session token.",
                    Headers = new Dictionary<string, IOpenApiHeader>
                    {
                        ["WWW-Authenticate"] = new OpenApiHeader { Schema = new OpenApiSchema { Type = JsonSchemaType.String } },
                    },
                    Content = new Dictionary<string, OpenApiMediaType>
                    {
                        ["application/problem+json"] = new() { Schema = new OpenApiSchemaReference(ProblemSchema, document) },
                    },
                };
            }

            return Task.CompletedTask;
        });
}
