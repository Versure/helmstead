import { createProjectGraphAsync } from '@nx/devkit';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import { ESLint, type Linter } from 'eslint';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './lint-fixture';

// Spec 002 criterion 9: strict TypeScript and no `any` in every frontend project, read from the effective configs so
// that a project that overrides a setting, or a new project generated without it, fails here.

const graph = await createProjectGraphAsync();
const frontendProjects = Object.values(graph.nodes)
  .map((node) => ({
    name: node.name,
    root: node.data.root,
    tags: node.data.tags ?? [],
  }))
  .filter(
    ({ root, tags }) =>
      tags.includes('scope:web') && !root.startsWith('tools/eslint/fixtures/'),
  );

const UNSAFE_RULES = Object.entries(tsPlugin.rules)
  .filter(
    ([name, rule]) => name.startsWith('no-unsafe-') && !rule.meta.deprecated,
  )
  .map(([name]) => `@typescript-eslint/${name}`);

interface AngularCompilerOptions {
  strictTemplates?: boolean;
}

/** Compiler and Angular compiler options of a tsconfig after following `extends`. */
function effectiveTsconfig(file: string) {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    file,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined },
  );
  let angular: AngularCompilerOptions = {};
  for (let current: string | undefined = file; current;) {
    const { config } = ts.readConfigFile(current, ts.sys.readFile) as {
      config: {
        extends?: string;
        angularCompilerOptions?: AngularCompilerOptions;
      };
    };
    angular = { ...config.angularCompilerOptions, ...angular };
    current = config.extends
      ? path.resolve(path.dirname(current), config.extends)
      : undefined;
  }

  return { options: parsed?.options ?? {}, angular };
}

const severity = (rule: Linter.RuleEntry | undefined) =>
  Array.isArray(rule) ? rule[0] : rule;
const isError = (rule: Linter.RuleEntry | undefined) =>
  severity(rule) === 2 || severity(rule) === 'error';

describe('every frontend project is strict', () => {
  it('finds the frontend projects', () => {
    expect(frontendProjects.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        'web',
        'ui',
        'system-feature',
        'system-data-access',
      ]),
    );
  });

  describe.each(frontendProjects)('$name', ({ root, tags }) => {
    const tsconfigs = [
      'tsconfig.app.json',
      'tsconfig.lib.json',
      'tsconfig.spec.json',
    ]
      .map((name) => path.join(repoRoot, root, name))
      .filter((file) => existsSync(file));

    it('has a build tsconfig (and a spec tsconfig when it has tests)', () => {
      expect(
        tsconfigs.filter((file) => !file.endsWith('tsconfig.spec.json')),
      ).toHaveLength(1);
    });

    it.each(tsconfigs.map((file) => [path.basename(file), file]))(
      '%s turns on strict, noUncheckedIndexedAccess, noImplicitOverride and strictTemplates',
      (_name, file) => {
        const { options, angular } = effectiveTsconfig(file);

        expect({
          strict: options.strict,
          noUncheckedIndexedAccess: options.noUncheckedIndexedAccess,
          noImplicitOverride: options.noImplicitOverride,
          strictTemplates: angular.strictTemplates,
        }).toEqual({
          strict: true,
          noUncheckedIndexedAccess: true,
          noImplicitOverride: true,
          strictTemplates: true,
        });
      },
    );

    it('has exactly one ESLint config, at its root', () => {
      const configs = readdirSync(path.join(repoRoot, root), {
        recursive: true,
        encoding: 'utf8',
      }).filter((file) => /(^|[\\/])eslint\.config\.[cm]?[jt]s$/.test(file));

      expect(configs).toEqual(['eslint.config.mjs']);
    });

    it('uses the shared web ESLint config and nothing else', () => {
      const config = readFileSync(
        path.join(repoRoot, root, 'eslint.config.mjs'),
        'utf8',
      );

      expect(config).toMatch(
        /^import \{ webProject \} from '(\.\.\/)+tools\/eslint\/eslint\.web\.config\.mjs';\n\nexport default webProject\(import\.meta\.dirname\);\n$/,
      );
    });

    it('makes no-explicit-any and every no-unsafe-* rule an error', async () => {
      const eslint = new ESLint({
        cwd: repoRoot,
        flags: ['v10_config_lookup_from_file'],
      });
      const config = (await eslint.calculateConfigForFile(
        path.join(repoRoot, root, 'src/index.ts'),
      )) as Linter.Config;
      const rules = config.rules ?? {};
      const expected = [
        '@typescript-eslint/no-explicit-any',
        ...UNSAFE_RULES,
        ...(tags.includes('type:data-access')
          ? ['helmstead/contract-types']
          : []),
      ];

      expect(expected.filter((rule) => !isError(rules[rule]))).toEqual([]);
    });
  });
});
