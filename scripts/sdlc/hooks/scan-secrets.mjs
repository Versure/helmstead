#!/usr/bin/env node
// PreToolUse hook for Bash and PowerShell (spec 003 criterion 10). Before Claude runs a command that may make a git
// commit, it scans what that commit would include with the pinned gitleaks and blocks the command (exit code 2) on a
// finding. The message names the rule, file and line, never the secret. When gitleaks cannot be obtained or fails,
// or the hook cannot tell which repository the commit is in, the command is blocked too: this hook fails closed.
//
// What gets scanned:
//   a lone `git commit [-m ...]`         the index (gitleaks git --staged)
//   a lone `git commit -a` / `--all`     the index plus changes to tracked files
//   a lone `git commit <paths>`          the index plus the working tree of those paths
//   anything else                        the index plus every working-tree change (git add -A on a copy of the
//                                        index): other commands before the commit, several commits, -i/-o, options
//                                        or quoting the hook does not fully understand, and git aliases of commit.
// Changes are scanned through a temporary copy of the index, so the real index is never changed. Content that an
// earlier part of the same command only creates (a generator, a redirect) does not exist yet when the hook runs; the
// secret-scan CI job catches it in the pull request.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// A `git` program word: at the start, after a separator or quote, or at the end of a path (/usr/bin/git, \git).
const GIT = /(?:^|[\s;&|(`'"\\/])git(?:\.exe)?(?=\s)/g;
// git commit options that take the next word as their value.
const WITH_VALUE = new Set([
  '-m', '--message', '-F', '--file', '-C', '--reuse-message', '-c', '--reedit-message', '--author', '--date', '-t',
  '--template', '--fixup', '--squash', '--cleanup', '--trailer',
]);
// git commit long options that are known to add no paths.
const PLAIN_LONG = new Set([
  '--amend', '--no-edit', '--edit', '--allow-empty', '--allow-empty-message', '--signoff', '--no-signoff', '--quiet',
  '--verbose', '--dry-run', '--short', '--branch', '--porcelain', '--long', '--null', '--no-gpg-sign', '--gpg-sign',
  '--reset-author', '--status', '--no-status', '--no-post-rewrite',
]);
// git global options that take the next word as their value.
const GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
const CD = /^\s*(?:cd|pushd|Set-Location|sl)\s+(?:-LiteralPath\s+|-Path\s+)?("[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*$/i;

/**
 * Works out whether `command` may commit, where, and what to scan.
 * @param {string} command the Bash or PowerShell command
 * @param {string} cwd the directory it runs in
 * @param {string[]} [aliases] git aliases that run commit
 * @returns {undefined | { block: string } | { cwd: string, mode: 'staged' | 'tracked' | 'all' | 'paths', paths: string[] }}
 */
export function planScan(command, cwd, aliases = []) {
  const subcommands = new Set(['commit', ...aliases]);
  const commits = [];
  for (const match of command.matchAll(GIT)) {
    const after = command.slice(match.index + match[0].length);
    const rest = tokenize(after);
    if (rest === undefined) {
      // Quoting the hook cannot follow (a substitution inside quotes, a here-document). If a commit subcommand
      // appears on the line, treat it as a commit of every change; a -C on it makes the repository unknown.
      const line = after.split('\n')[0];
      const asWord = (name) => new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
      const word = [...subcommands].find((name) => asWord(name).test(line));
      if (word !== undefined) {
        const head = line.slice(0, line.search(asWord(word)));
        commits.push({ index: match.index, rest, words: [], dir: /(^|\s)(-C|--git-dir|--work-tree)\b/.test(head) ? '$' : undefined, alias: true });
      }
      continue;
    }
    const words = rest;
    // Skip git's global options to find the subcommand.
    let i = 0;
    let dir;
    while (i < words.length && words[i].startsWith('-')) {
      if (GLOBAL_WITH_VALUE.has(words[i])) {
        if (words[i] === '-C') dir = words[i + 1];
        if (words[i] === '--git-dir' || words[i] === '--work-tree') dir = '$';
        i += 2;
      } else if (/^--(git-dir|work-tree)=/.test(words[i])) {
        dir = '$';
        i++;
      } else {
        i++;
      }
    }
    if (subcommands.has(words[i])) {
      commits.push({ index: match.index, rest, words: words.slice(i + 1), dir, alias: words[i] !== 'commit' });
    }
  }
  if (commits.length === 0) {
    // `git -c alias.<name>=commit <name>` defines a commit alias on the command line: scan every change.
    return /(^|\s)-c\s+["']?alias\./.test(command) && /\bgit\b/.test(command)
      ? { cwd, mode: 'all', paths: [] }
      : undefined;
  }

  // The hook scans one repository, found from the hook's cwd, one leading `cd <dir> &&` and `git -C <dir>`. Anything
  // else that can move the commit somewhere else is refused rather than guessed: a later or nested cd, a subshell or
  // shell -c, git's own GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE, commits in different folders, and force-adds of ignored
  // files (git add -A on the scan's copy of the index would leave them out).
  const [first] = commits;
  const before = command.slice(0, first.index);
  const cd = CD.exec(before);
  const rest = cd ? command.slice(cd[0].length) : command;
  const separate = 'Run the commit as its own command from the repository folder (stage files in an earlier command).';
  if (/(^|[\s;&|(])(cd|pushd|popd|Push-Location|Pop-Location|Set-Location|sl|chdir)(\s|$|;)/i.test(rest)) {
    return { block: `the command changes folder around the commit, so the hook cannot tell which repository to scan. ${separate}` };
  }
  if (/(^|[\s;&|])\(|\b(bash|sh|zsh|pwsh|powershell|cmd)(\.exe)?\s+(-\w*c|-Command|\/c)\b|\beval\b/i.test(command)) {
    return { block: `the commit runs in a subshell or nested shell, which the hook cannot follow. ${separate}` };
  }
  if (/\b(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_COMMON_DIR)\b/.test(command)) {
    return { block: `the command sets GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE, so the hook cannot tell what is committed. ${separate}` };
  }
  if (new Set(commits.map((c) => c.dir)).size > 1) {
    return { block: `the command commits in more than one folder. ${separate}` };
  }
  if (/\bgit(\.exe)?\b[^;&|\n]*\s(add|stage)\b[^;&|\n]*\s(-f|--force|-\w*f\w*)\b|\bupdate-index\b/.test(before)) {
    return { block: `files are force-added or the index is changed directly in the same command as the commit. ${separate}` };
  }
  let dir = cwd;
  const target = first.dir ?? cd?.[1];
  if (target !== undefined) {
    const quoted = /^(["'])(.*)\1$/.exec(target);
    const literal = quoted ? quoted[2] : target;
    if (literal === '' || /[$`*?~%]/.test(literal)) {
      return { block: `cannot tell which repository "${target}" is, so the commit cannot be scanned. Use a literal path.` };
    }
    dir = path.resolve(cd && first.dir ? path.resolve(cwd, cd[1].replace(/^["']|["']$/g, '')) : cwd, literal);
  }

  // Only a single, plainly written commit (at most after a cd) gets a narrow scan; anything else scans every change.
  const alone = commits.length === 1 && !first.alias && first.rest !== undefined && (before.trim() === '' || cd !== null);
  const everything = { cwd: dir, mode: 'all', paths: [] };
  if (!alone) return everything;

  const paths = [];
  let all = false;
  for (let i = 0; i < first.words.length; i++) {
    const token = first.words[i];
    if (token === '--') {
      paths.push(...first.words.slice(i + 1));
      break;
    }
    if (WITH_VALUE.has(token)) {
      i++;
    } else if (token.startsWith('--')) {
      const [name] = token.split('=');
      if (name === '--all' && !token.includes('=')) all = true;
      // --include, --only, --pathspec-from-file, abbreviations (--al) and anything else not known to be harmless.
      else if (token.includes('=') ? !WITH_VALUE.has(name) : !PLAIN_LONG.has(name)) return everything;
    } else if (token.startsWith('-') && token.length > 1) {
      // Bundled short options, e.g. -am "message" or -qa.
      for (let j = 1; j < token.length; j++) {
        const flag = token[j];
        if (flag === 'a') all = true;
        else if (flag === 'i' || flag === 'o') return everything;
        if ('mFCct'.includes(flag)) {
          if (j === token.length - 1) i++; // the value is the next word
          break; // otherwise the rest of the word is the value
        }
      }
    } else {
      paths.push(token);
    }
  }
  if (paths.length > 0) return all ? everything : { cwd: dir, mode: 'paths', paths };
  if (all) return { cwd: dir, mode: 'tracked', paths: [] };
  return { cwd: dir, mode: 'staged', paths: [] };
}

/**
 * Splits the words after `git`, up to the end of that shell command. Quotes are honoured; `$(...)` is kept as one
 * word. Returns undefined when it cannot tell (an unclosed quote, a here-document, a substitution inside quotes),
 * and the caller then scans every working-tree change.
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
      else if (c === '$' && text[i + 1] === '(' && quote === '"') return undefined;
      else if (c === '\\' && quote === '"') word += text[++i] ?? '';
      else word += c;
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

/** The git aliases (in the configuration seen from `cwd`) whose definition runs commit. */
export function commitAliases(cwd) {
  const run = spawnSync('git', ['config', '--get-regexp', '^alias\\.'], { cwd, encoding: 'utf8' });
  if (run.status !== 0) return [];
  return run.stdout
    .split('\n')
    .map((line) => /^alias\.(\S+)\s+(.*)$/.exec(line))
    .filter((m) => m !== null && /\bcommit\b/.test(m[2]))
    .map((m) => m[1]);
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
  if (top.status !== 0) {
    // Not inside a work tree: refuse rather than let an unscanned commit through.
    throw new Error(`${plan.cwd} is not inside a git work tree, so the hook cannot tell what the commit would include.`);
  }
  const root = top.stdout.trim();
  if (plan.mode === 'staged') return scan(root, process.env);

  const index = path.resolve(root, git(root, ['rev-parse', '--git-path', 'index']).stdout.trim());
  const dir = mkdtempSync(path.join(tmpdir(), 'helmstead-commit-index-'));
  const tempIndex = path.join(dir, 'index');
  try {
    if (existsSync(index)) copyFileSync(index, tempIndex);
    const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
    // Paths are given as the commit would see them: relative to the folder it runs in, so git resolves them, not us
    // (on Windows the same folder can be spelled two ways, e.g. RUNNER~1 and runneradmin).
    const add =
      plan.mode === 'tracked'
        ? ['add', '-u']
        : plan.mode === 'paths'
          ? ['add', '-A', '--', ...plan.paths]
          : ['add', '-A', '--', ':/'];
    const added = git(plan.mode === 'paths' ? plan.cwd : root, add, env);
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
  const cwd = input.cwd || process.cwd();
  let plan;
  try {
    plan = planScan(String(input.tool_input?.command ?? ''), cwd, commitAliases(cwd));
  } catch (error) {
    block(`the command could not be read, so the commit is blocked.\n${error instanceof Error ? error.message : String(error)}`);
  }
  if (!plan) process.exit(0);
  if ('block' in plan) block(plan.block);

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
