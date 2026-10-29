using Helmstead.Agents.Fixture;
using Helmstead.Connectors.FixtureB;

namespace Helmstead.Providers.Fixture;

/// <summary>Test fixture: Providers wrongly depends on a connector and on Agents.</summary>
public sealed class ProviderFixtureType
{
    public string Name => new FixtureBType().Name + new AgentFixtureType().Name;
}
