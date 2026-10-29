using Helmstead.Core.Api;

namespace Helmstead.Core.Persistence.Fixture;

/// <summary>Test fixture: Persistence wrongly depends on Api.</summary>
public sealed class PersistenceFixtureType
{
    public HealthResponse Health => new("ok", "0");
}
