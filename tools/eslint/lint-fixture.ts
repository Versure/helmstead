import { ESLint } from 'eslint';
import path from 'node:path';

export const repoRoot = path.resolve(import.meta.dirname, '../..');

export interface LintMessage {
  ruleId: string | null;
  message: string;
}

/**
 * Lints source text as if it were the file at `filePath` (repo-relative), using the real root ESLint config.
 * The file does not have to exist, so fixtures never become part of a project or a build.
 */
export async function lintFixture(
  filePath: string,
  code: string,
): Promise<LintMessage[]> {
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, filePath),
  });

  return result.messages.map(({ ruleId, message }) => ({ ruleId, message }));
}

export const errorsOf = (messages: LintMessage[], ruleId: string) =>
  messages.filter((message) => message.ruleId === ruleId);
