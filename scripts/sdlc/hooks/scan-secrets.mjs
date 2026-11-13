#!/usr/bin/env node
// PreToolUse hook for Bash and PowerShell (spec 003 criterion 10). Before Claude runs `git commit`, it scans what
// that commit would include with the pinned gitleaks and blocks the command (exit code 2) on a finding. The message
// names the rule, file and line, never the secret. When gitleaks cannot be obtained or fails, the commit is blocked
// too: this hook fails closed.
//
// What a commit would include:
//   git commit                      the index (gitleaks git --staged)
//   git commit -a / --all           the index plus changes to tracked files
//   git commit <paths>, -i, -o      the index plus the working tree of those paths
//   git add ... && git commit       the index plus every working-tree change, since the add runs first
// The last three are scanned through a temporary copy of the index, so the real index is never changed.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// `git` with optional global options (-C <dir>, -c <k=v>, --no-pager, ...), then `commit` as the subcommand.
const COMMIT = /(?:^|[\s;&|(`'"])git(?:\.exe)?((?:\s+(?:-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+)|--[\w-]+(?:=\S+)?))*)\s+commit(?=\s|$|[;&|)`'"])/;
// Options of git commit that take a value as the next word.
const WITH_VALUE = new Set(['-m', '--message', '-F', '--file', '-C', '--reuse-message', '-c', '--reedit-message', '--author', '--date', '-t', '--template', '--fixup', '--squash', '--cleanup', '--trailer', '--pathspec-from-file']);

/**
 * Works out what `command` would commit.
 * @returns {undefined | { cwd: string, mode: 'staged' | 'tracked' | 'all' | 'paths', paths: string[] }}
 */
export function planScan(command, cwd) {
  const match = COMMIT.exec(command);
  if (!match) return undefined;
  const globalDir = /-C\s+("[^"]*"|'[^']*'|\S+)/.exec(match[1] ?? '')?.[1]?.replace(/^["']|["']$/g, '');
  const dir = globalDir ? path.resolve(cwd, globalDir) : cwd;
  const before = command.slice(0, match.index);
  const tokens = tokenize(command.slice(match.index + match[0].length));

  if (tokens === undefined) return { cwd: dir, mode: 'all', paths: [] };
  const paths = [];
  let all = false;
  let pathOptions = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--') {
      paths.push(...tokens.slice(i + 1));
      break;
    }
    if (WITH_VALUE.has(token)) {
      i++;
    } else if (token.startsWith('--')) {
      if (token === '--all') all = true;
      if (token === '--include' || token === '--only') pathOptions = true;
      // Other long options, and --option=value, carry no path.
    } else if (token.startsWith('-') && token.length > 1) {
      // Bundled short options, e.g. -am "message" or -qa.
      for (let j = 1; j < token.length; j++) {
        const flag = token[j];
        if (flag === 'a') all = true;
        if (flag === 'i' || flag === 'o') pathOptions = true;
        if ('mFCct'.includes(flag)) {
          if (j === token.length - 1) i++; // the value is the next word
          break; // otherwise the rest of the word is the value
        }
      }
    } else {
      paths.push(token);
    }
  }
  // Anything added earlier in the same command is staged by the time the commit runs.
  if (/\bgit(?:\.exe)?\b[^;&|]*\s(add|stage|rm|mv)\b/.test(before)) return { cwd: dir, mode: 'all', paths: [] };
  if (paths.length > 0) return { cwd: dir, mode: 'paths', paths };
  if (pathOptions) return { cwd: dir, mode: 'all', paths: [] };
  if (all) return { cwd: dir, mode: 'tracked', paths: [] };
  return { cwd: dir, mode: 'staged', paths: [] };
}

/**
 * Splits the arguments of the commit, up to the end of that shell command, into words. Quotes are honoured;
 * `$(...)`, backticks and here-documents are kept as one word. Returns undefined when it cannot tell, and the
 * caller then scans every working-tree change.
 */
function tokenize(text) {
  const words = [];
  let word = '';
  let quote = '';
  let depth = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
      else if (c === '\\' && quote === '"') word += text[++i] ?? '';
      else word += c;
      if (c === '$' && text[i + 1] === '(' && quote === '"') {
        depth++;
      }
      continue;
    }
    if (depth > 0) {
      if (c === '(') depth++;
      if (c === ')') depth--;
      word += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      inWord = true;
    } else if (c === '$' && text[i + 1] === '(') {
      depth = 1;
      word += '$(';
      i++;
      inWord = true;
    } else if (c === '<' && text[i + 1] === '<') {
      return undefined;
    } else if (/\s/.test(c)) {
      if (c === '\n') break;
      if (inWord) words.push(word);
      word = '';
      inWord = false;
    } else if (';&|)'.includes(c)) {
      break;
    } else if (c === '\\') {
      word += text[++i] ?? '';
      inWord = true;
    } else {
      word += c;
      inWord = true;
    }
  }
  if (quote || depth > 0) return undefined;
  if (inWord) words.push(word);
  return words;
}

const git = (cwd, args, env = process.env) => spawnSync('git', args, { cwd, env, encoding: 'utf8' });

/**
 * Scans what the planned commit would include.
 * @param {{ cwd: string, mode: string, paths: string[] }} plan
 * @param {(cwd: string, env: NodeJS.ProcessEnv) => { findings: any[] }} scan runs `gitleaks git --staged` with that env
 * @returns {{ findings: any[] }}
 */
export function scanPlan(plan, scan) {
  const top = git(plan.cwd, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return { findings: [] }; // Not a git repository: git commit itself will fail.
  const root = top.stdout.trim();
  if (plan.mode === 'staged') return scan(root, process.env);

  const index = path.resolve(root, git(root, ['rev-parse', '--git-path', 'index']).stdout.trim());
  const dir = mkdtempSync(path.join(tmpdir(), 'helmstead-commit-index-'));
  const tempIndex = path.join(dir, 'index');
  try {
    if (existsSync(index)) copyFileSync(index, tempIndex);
    const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
    const add =
      plan.mode === 'tracked'
        ? ['add', '-u']
        : plan.mode === 'paths'
          ? ['add', '-A', '--', ...plan.paths.map((p) => path.relative(root, path.resolve(plan.cwd, p)) || '.')]
          : ['add', '-A'];
    const added = git(root, add, env);
    if (added.status !== 0) throw new Error(`git ${add.join(' ')} failed while preparing the scan: ${added.stderr.trim()}`);
    return scan(root, env);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function blockMessage(findings) {
  return [
    `gitleaks found ${findings.length} possible secret${findings.length === 1 ? '' : 's'} in what this commit would include (values not shown):`,
    ...findings.map((f) => `  - rule ${f.RuleID} in ${f.File} line ${f.StartLine}${f.Fingerprint ? ` (fingerprint ${f.Fingerprint})` : ''}`),
    'Remove the secret from the change (and rotate it if it is real). Build test tokens at runtime, never as literals.',
    'If it is a false positive, add its fingerprint to .gitleaksignore: a high-risk change the owner reviews.',
  ].join('\n');
}

function block(reason) {
  process.stderr.write(`Blocked by scripts/sdlc/hooks/scan-secrets.mjs: ${reason}\n`);
  process.exit(2);
}

async function main() {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {}
  const plan = planScan(String(input.tool_input?.command ?? ''), input.cwd || process.cwd());
  if (!plan) process.exit(0);

  try {
    const { ensureGitleaks, runGitleaks } = await import(pathToFileURL(path.join(repoRoot, 'tools/supply-chain/gitleaks.mjs')).href);
    const binary = await ensureGitleaks({ log: (m) => process.stderr.write(`${m}\n`) });
    const { findings } = scanPlan(plan, (root, env) => runGitleaks(binary, ['git', '--staged', root], { cwd: root, env }));
    if (findings.length > 0) block(blockMessage(findings));
  } catch (error) {
    block(`the secret scan could not run, so the commit is blocked.\n${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
