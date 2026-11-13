import { describe, expect, it } from 'vitest';
import { classify } from '../../scripts/sdlc/classify-risk.mjs';

// Spec 003 criterion 2: the files that judge dependencies, secrets and network access are high risk, so a change
// to them (an exception, a loosened rule, a weaker guard) always waits for the owner.
describe('risk-paths.json', () => {
  it.each([
    ['dependency-policy.json', 'pipeline'],
    ['.gitleaks.toml', 'security'],
    ['.gitleaksignore', 'security'],
    ['tools/supply-chain/licenses.mjs', 'security'],
    ['tools/supply-chain/gitleaks.json', 'security'],
    ['tools/testing/no-network.ts', 'security'],
    ['tools/workspace/no-network.spec.ts', 'architecture'],
    ['apps/core/tests/Shared/NoNetwork.cs', 'security'],
    ['apps/core/tests/Directory.Build.props', 'pipeline'],
    [
      'apps/core/tests/Helmstead.Core.Tests/Architecture/NetworkRules.cs',
      'architecture',
    ],
    ['scripts/sdlc/hooks/scan-secrets.mjs', 'pipeline'],
    ['.github/workflows/supply-chain-weekly.yml', 'pipeline'],
  ])('classifies %s as high risk (%s)', (file, category) => {
    const result = classify([file]);

    expect(result.risk).toBe('high');
    expect(result.categories[category]).toContain(file);
  });
});
