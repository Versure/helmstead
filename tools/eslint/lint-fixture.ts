import { ESLint } from 'eslint';
import path from 'node:path';

export const repoRoot = path.resolve(import.meta.dirname, '../..');

export interface LintMessage {
  ruleId: string | null;
  message: string;
}

/**
 * Lints source text as if it were the file at `filePath` (repo-relative), using the real ESLint config of that file.
 * The file does not have to exist, so fixtures never become part of a project or a build.
 */
export async function lintFixture(
  filePath: string,
  code: string,
): Promise<LintMessage[]> {
  // Like `nx lint`, use the config nearest to the file (apps/web and libs/ui add the Angular rules).
  const eslint = new ESLint({
    cwd: repoRoot,
    flags: ['v10_config_lookup_from_file'],
  });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, filePath),
  });

  return result.messages.map(({ ruleId, message }) => ({ ruleId, message }));
}

export const errorsOf = (messages: LintMessage[], ruleId: string) =>
  messages.filter((message) => message.ruleId === ruleId);
