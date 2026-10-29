using Helmstead.Connectors.FixtureB;

namespace Helmstead.Agents.Fixture;

/// <summary>Test fixture: Agents wrongly depends on a connector.</summary>
public sealed class AgentFixtureType
{
    public string Name => new FixtureBType().Name;
}
