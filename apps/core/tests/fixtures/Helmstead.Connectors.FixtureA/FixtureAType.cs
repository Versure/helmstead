using Helmstead.Agents.Fixture;
using Helmstead.Connectors.FixtureB;
using Helmstead.Providers.Fixture;

namespace Helmstead.Connectors.FixtureA;

/// <summary>Test fixture: a connector that wrongly depends on another connector, on Agents and on Providers.</summary>
public sealed class FixtureAType
{
    public string Name => new FixtureBType().Name + new AgentFixtureType().Name + new ProviderFixtureType().Name;
}
