import { createProjectGraphAsync } from '@nx/devkit';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIVE_TEST_GLOB, liveTestExclude } from '../testing/live-tests.mjs';
import {
  checkAngularTarget,
  checkNetworkGuard,
  checkVitestConfig,
  loadVitestTestConfig,
  runnerOf,
  type TestTarget,
} from './no-network';

const repoRoot = path.resolve(import.meta.dirname, '../..');

async function workspaceTestTargets(): Promise<TestTarget[]> {
  const graph = await createProjectGraphAsync();
  return Object.values(graph.nodes)
    .filter((node) => !node.data.root.startsWith('tools/eslint/fixtures/'))
    .flatMap((node) =>
      Object.entries(node.data.targets ?? {}).map(([target, config]) => ({
        project: node.name,
        root: node.data.root,
        target,
        executor: config.executor,
        options: config.options as Record<string, unknown> | undefined,
      })),
    )
    .filter(
      (t) =>
        t.target.startsWith('test') ||
        ['angular', 'vitest'].includes(runnerOf(t)),
    );
}

describe('the network guard is registered (spec 003 criterion 14)', () => {
  it('in every test target of the workspace', async () => {
    const targets = await workspaceTestTargets();

    // The check covers every runner in use today, so a target that slips out of it shows up here.
    expect(new Set(targets.map(runnerOf))).toEqual(
      new Set(['angular', 'vitest', 'dotnet', 'noop']),
    );
    expect(await checkNetworkGuard(targets, repoRoot)).toEqual([]);
  });

  it('in the guard-rail tests under tools/', async () => {
    const test = await loadVitestTestConfig(
      path.join(repoRoot, 'tools/vitest.config.mts'),
    );

    expect(
      checkVitestConfig('tools', path.join(repoRoot, 'tools'), test, repoRoot),
    ).toEqual([]);
  });

  it('fails an Angular target without the setup file or the live-test exclude', () => {
    expect(
      checkAngularTarget({
        project: 'fixture',
        root: 'libs/fixture',
        target: 'test',
        executor: '@nx/angular:unit-test',
        options: { watch: false },
      }),
    ).toEqual([
      'Test target "fixture:test" does not load tools/testing/no-network.ts; add it to options.setupFiles.',
      'Test target "fixture:test" does not exclude **/*.live.spec.ts; add it to options.exclude.',
    ]);
  });

  it('fails a Vitest config without the setup file', () => {
    expect(
      checkVitestConfig(
        'fixture',
        path.join(repoRoot, 'libs/fixture'),
        { include: ['src/**/*.spec.ts'], exclude: [LIVE_TEST_GLOB] },
        repoRoot,
      ),
    ).toEqual([
      'Vitest config of "fixture" does not load tools/testing/no-network.ts; add it to test.setupFiles.',
    ]);
  });

  it('fails a setup file path that points somewhere else', () => {
    expect(
      checkVitestConfig(
        'fixture',
        path.join(repoRoot, 'libs/fixture'),
        {
          setupFiles: ['./tools/testing/no-network.ts'],
          exclude: [LIVE_TEST_GLOB],
        },
        repoRoot,
      ),
    ).toHaveLength(1);
  });

  it('fails a test runner it does not know', async () => {
    expect(
      await checkNetworkGuard(
        [
          {
            project: 'fixture',
            root: 'libs/fixture',
            target: 'test',
            executor: '@nx/jest:jest',
            options: {},
          },
        ],
        repoRoot,
      ),
    ).toEqual([
      'Test target "fixture:test" uses a runner the network guard does not know (@nx/jest:jest). Register tools/testing/no-network.ts for it and teach tools/workspace/no-network.ts about it.',
    ]);
  });
});

describe('live tests (spec 003 criterion 16)', () => {
  it('are left out of every default test run', () => {
    expect(liveTestExclude({})).toEqual([LIVE_TEST_GLOB]);
    expect(liveTestExclude({ HELMSTEAD_LIVE_TESTS: '1' })).toEqual([]);
  });

  it('are never enabled by a workflow', () => {
    const dir = path.join(repoRoot, '.github/workflows');
    for (const file of readdirSync(dir)) {
      expect(readFileSync(path.join(dir, file), 'utf8'), file).not.toMatch(
        /HELMSTEAD_LIVE_TESTS/,
      );
    }
  });
});
