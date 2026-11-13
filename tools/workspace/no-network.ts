import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LIVE_TEST_GLOB } from '../testing/live-tests.mjs';

export const NETWORK_SETUP_FILE = 'tools/testing/no-network.ts';

const ANGULAR_EXECUTORS = ['@angular/build:unit-test', '@nx/angular:unit-test'];

export interface TestTarget {
  project: string;
  root: string;
  target: string;
  executor?: string;
  options?: Record<string, unknown>;
}

export interface VitestTestConfig {
  setupFiles?: string | string[];
  exclude?: string[];
  include?: string[];
}

const asList = (value: unknown): string[] =>
  value === undefined
    ? []
    : Array.isArray(value)
      ? value.map(String)
      : [String(value)];

/**
 * The kind of runner a test target uses. Only runners this check knows can pass; a new runner fails until the
 * network guard is registered for it here (spec 003 criterion 14).
 */
export function runnerOf(
  target: TestTarget,
): 'angular' | 'vitest' | 'dotnet' | 'noop' | 'unknown' {
  if (target.executor && ANGULAR_EXECUTORS.includes(target.executor))
    return 'angular';
  if (target.executor === 'nx:noop') return 'noop';
  const command = String(target.options?.['command'] ?? '');
  if (target.executor === 'nx:run-commands' && /^vitest(\s|$)/.test(command))
    return 'vitest';
  if (target.executor === '@nx/vitest:test') return 'vitest';
  if (
    target.executor === 'nx:run-commands' &&
    /^dotnet test(\s|$)/.test(command)
  )
    return 'dotnet';
  return 'unknown';
}

/** Checks an Angular test target: it loads the setup file and leaves out the live tests. */
export function checkAngularTarget(target: TestTarget): string[] {
  const errors: string[] = [];
  const name = `${target.project}:${target.target}`;
  if (!asList(target.options?.['setupFiles']).includes(NETWORK_SETUP_FILE)) {
    errors.push(
      `Test target "${name}" does not load ${NETWORK_SETUP_FILE}; add it to options.setupFiles.`,
    );
  }
  if (!asList(target.options?.['exclude']).includes(LIVE_TEST_GLOB)) {
    errors.push(
      `Test target "${name}" does not exclude ${LIVE_TEST_GLOB}; add it to options.exclude.`,
    );
  }
  if (
    asList(target.options?.['include']).some((glob) => glob.includes('.live.'))
  ) {
    errors.push(`Test target "${name}" includes live tests by default.`);
  }
  return errors;
}

/** Checks a Vitest config: its setup files include the guard and its exclude list has the live tests. */
export function checkVitestConfig(
  name: string,
  configDir: string,
  test: VitestTestConfig | undefined,
  repoRoot: string,
): string[] {
  const errors: string[] = [];
  const guard = path.join(repoRoot, NETWORK_SETUP_FILE);
  if (
    !asList(test?.setupFiles).some(
      (file) => path.resolve(configDir, file) === guard,
    )
  ) {
    errors.push(
      `Vitest config of "${name}" does not load ${NETWORK_SETUP_FILE}; add it to test.setupFiles.`,
    );
  }
  if (!asList(test?.exclude).includes(LIVE_TEST_GLOB)) {
    errors.push(
      `Vitest config of "${name}" does not exclude ${LIVE_TEST_GLOB}; add liveTestExclude() to test.exclude.`,
    );
  }
  if (asList(test?.include).some((glob) => glob.includes('.live.'))) {
    errors.push(`Vitest config of "${name}" includes live tests by default.`);
  }
  return errors;
}

/** Loads the `test` block of a Vitest config file, as Vitest would see it in a normal run. */
export async function loadVitestTestConfig(
  file: string,
): Promise<VitestTestConfig | undefined> {
  const loaded = (await import(pathToFileURL(file).href)) as {
    default: unknown;
  };
  const config =
    typeof loaded.default === 'function'
      ? await (loaded.default as (env: object) => unknown)({
          command: 'serve',
          mode: 'test',
        })
      : loaded.default;
  return (config as { test?: VitestTestConfig }).test;
}

export function vitestConfigOf(
  root: string,
  repoRoot: string,
): string | undefined {
  for (const name of [
    'vitest.config.mts',
    'vitest.config.ts',
    'vitest.config.mjs',
    'vitest.config.js',
    'vite.config.mts',
    'vite.config.ts',
  ]) {
    const file = path.join(repoRoot, root, name);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/** Every test target in the workspace, checked. .NET test projects are checked by the .NET tests themselves. */
export async function checkNetworkGuard(
  targets: TestTarget[],
  repoRoot: string,
): Promise<string[]> {
  const errors: string[] = [];
  for (const target of targets) {
    switch (runnerOf(target)) {
      case 'angular':
        errors.push(...checkAngularTarget(target));
        break;
      case 'vitest': {
        const file = vitestConfigOf(target.root, repoRoot);
        if (!file) {
          errors.push(
            `Test target "${target.project}:${target.target}" runs Vitest but has no vitest.config file.`,
          );
          break;
        }
        errors.push(
          ...checkVitestConfig(
            target.project,
            path.dirname(file),
            await loadVitestTestConfig(file),
            repoRoot,
          ),
        );
        break;
      }
      case 'dotnet':
      case 'noop':
        break;
      default:
        errors.push(
          `Test target "${target.project}:${target.target}" uses a runner the network guard does not know (${target.executor}). Register tools/testing/no-network.ts for it and teach tools/workspace/no-network.ts about it.`,
        );
    }
  }
  return errors;
}
