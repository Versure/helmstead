import { createProjectGraphAsync } from '@nx/devkit';
import { ESLint } from 'eslint';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import tseslint from 'typescript-eslint';

let graph: Promise<unknown> | undefined;
const ensureProjectGraph = () => (graph ??= createProjectGraphAsync());

export const repoRoot = path.resolve(import.meta.dirname, '../..');

export interface LintMessage {
  ruleId: string | null;
  message: string;
}

let fixtureCount = 0;

/**
 * Lints source text as if it were the file at `filePath` (repo-relative), using the real ESLint config of that file.
 * The file does not have to exist, so fixtures never become part of a project or a build. Sheriff resolves the linted
 * file on disk, though, so a TypeScript fixture whose path does not exist is written next to it under a unique name
 * (`<name>.lint-fixture-<pid>-<n>.ts`, git-ignored) for the length of the lint and removed again.
 */
export async function lintFixture(
  filePath: string,
  code: string,
): Promise<LintMessage[]> {
  // The boundary rule skips itself, with only a warning, when no project graph is cached (a fresh clone, CI).
  await ensureProjectGraph();
  // Like `nx lint`, use the config nearest to the file (apps/web and libs/ui add the Angular rules).
  // The frontend configs lint with type information, but a fixture is not on disk, so no tsconfig contains it.
  // Fixtures test the rules that read syntax and imports; the type-aware rules have their own RuleTester tests.
  const eslint = new ESLint({
    cwd: repoRoot,
    flags: ['v10_config_lookup_from_file'],
    overrideConfig: filePath.endsWith('.ts')
      ? {
          ...tseslint.configs.disableTypeChecked,
          files: ['**/*.ts'],
          rules: {
            ...tseslint.configs.disableTypeChecked.rules,
            'helmstead/contract-types': 'off',
          },
        }
      : undefined,
  });
  let target = path.join(repoRoot, filePath);
  let temporary: string | undefined;
  if (filePath.endsWith('.ts') && !existsSync(target)) {
    const name = path.basename(target);
    const dot = name.indexOf('.');
    temporary = path.join(
      path.dirname(target),
      `${name.slice(0, dot)}.lint-fixture-${process.pid}-${++fixtureCount}${name.slice(dot)}`,
    );
    writeFileSync(temporary, code, { flag: 'wx' });
    target = temporary;
  }
  try {
    const [result] = await eslint.lintText(code, { filePath: target });

    return result.messages.map(({ ruleId, message }) => ({ ruleId, message }));
  } finally {
    if (temporary) rmSync(temporary, { force: true });
  }
}

export const errorsOf = (messages: LintMessage[], ruleId: string) =>
  messages.filter((message) => message.ruleId === ruleId);
