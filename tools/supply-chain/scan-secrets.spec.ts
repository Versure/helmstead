import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  blockMessage,
  planScan,
  scanPlan,
} from '../../scripts/sdlc/hooks/scan-secrets.mjs';
import { cachedGitleaks } from './gitleaks.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const hook = path.join(repoRoot, 'scripts/sdlc/hooks/scan-secrets.mjs');

// A token in the format of a GitHub personal access token, built at runtime so the repository never holds one.
const fakeToken = () => {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return (
    ['g', 'h', 'p', '_'].join('') +
    Array.from({ length: 36 }, () => chars[randomInt(chars.length)]).join('')
  );
};

const git = (cwd: string, ...args: string[]) => {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
};

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'helmstead-scan-secrets-'));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(repo, 'config.ts'), 'export const port = 5108;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('planScan: what the commit would include', () => {
  it.each([
    ['git status', undefined],
    ['git commit-tree abc', undefined],
    ['echo "git commit"', undefined],
    ['git commit -m "fix: x"', 'staged'],
    ['git commit -m "$(cat <<\'EOF\'\nfix: x\nEOF\n)"', 'all'],
    ['git commit --amend --no-edit', 'staged'],
    ['git commit -a -m "x"', 'tracked'],
    ['git commit -am "x"', 'tracked'],
    ['git commit --all --message=x', 'tracked'],
    ['git commit -qa', 'tracked'],
    ['git commit -m "x" src/a.ts', 'paths'],
    ['git commit -m "x" -- src/a.ts', 'paths'],
    ['git commit -i -m "x"', 'all'],
    ['git add . && git commit -m "x"', 'all'],
    ['git add -A; git commit -m "x"', 'all'],
    ['git -C sub commit -m "x"', 'staged'],
    ['cd x && git -c core.editor=true commit -m "x" && git push', 'staged'],
    ['git.exe commit -m "x"', 'staged'],
    ['git -P commit -m x', 'staged'],
    // Anything but a lone, plainly written commit scans every working-tree change.
    ['/usr/bin/git commit -am x', 'all'],
    ['npm run gen && git add -A && git commit -m x', 'all'],
    ['git commit -m a && git commit -am b', 'all'],
    ['git commit --pathspec-from-file=f -m x', 'all'],
    ['git commit --al -m x', 'all'],
    ['git commit -a -m x src/a.ts', 'all'],
    ['git ci -m x', 'all'],
  ])('%j → %s', (command, mode) => {
    const plan = planScan(command, repoRoot, ['ci']);
    expect(plan && 'mode' in plan ? plan.mode : plan).toBe(mode);
  });

  it('follows a leading cd to the repository the commit runs in', () => {
    expect(planScan('cd sub && git commit -m x', repoRoot)).toEqual({
      cwd: path.join(repoRoot, 'sub'),
      mode: 'staged',
      paths: [],
    });
  });

  it.each([
    'git -C "$REPO" commit -m x',
    'git -C "$(git rev-parse --show-toplevel)" commit -m x',
    'cd $HOME/x && git commit -m x',
    'git --git-dir ../other/.git commit -m x',
  ])('blocks when it cannot tell the repository: %j', (command) => {
    expect(planScan(command, repoRoot)).toEqual({
      block: expect.stringContaining('cannot tell which repository'),
    });
  });

  it.each([
    [
      'cd .claude/worktrees/x && git add -A && git commit -m x',
      'changes folder',
    ],
    ['npm test && cd ../other && git commit -am x', 'changes folder'],
    [
      'git commit -m a && Push-Location ../o; git commit -am b',
      'changes folder',
    ],
    ['(cd ../other && git commit -am x)', 'changes folder'],
    ["bash -c 'git commit -am x'", 'nested shell'],
    ['GIT_DIR=../o/.git git commit -m x', 'GIT_DIR'],
    ['git commit -m a && git -C ../other commit -am b', 'more than one folder'],
    [
      'git add -f .claude/settings.local.json && git commit -m x',
      'force-added',
    ],
    ['git update-index --add x && git commit -m x', 'force-added'],
  ])('refuses a commit it cannot place: %j', (command, reason) => {
    const plan = planScan(command, repoRoot);
    expect(plan && 'block' in plan ? plan.block : plan).toContain(reason);
  });

  it('scans everything for an alias defined on the command line', () => {
    expect(planScan('git -c alias.ci=commit ci -am x', repoRoot)).toEqual({
      cwd: repoRoot,
      mode: 'all',
      paths: [],
    });
  });

  it('copes with alias names that are not valid regular expressions', () => {
    expect(() =>
      planScan('git x(y -m "$(cat <<EOF\nm\nEOF\n)"', repoRoot, ['x(y']),
    ).not.toThrow();
  });

  it('keeps the paths of git commit <paths>', () => {
    expect(
      planScan('git commit -m "a b" one.ts "two words.ts"', repoRoot),
    ).toEqual({
      cwd: repoRoot,
      mode: 'paths',
      paths: ['one.ts', 'two words.ts'],
    });
  });

  it('follows git -C to the repository the commit runs in', () => {
    expect(planScan('git -C sub commit -m x', repoRoot)?.cwd).toBe(
      path.join(repoRoot, 'sub'),
    );
  });
});

// A stand-in for `gitleaks git --staged`: it reads `git diff --staged` with the same environment (so it sees the
// temporary index) and reports a line with the token, the way gitleaks does.
const fakeGitleaks =
  (token: string) => (root: string, env: NodeJS.ProcessEnv) => {
    const diff = spawnSync(
      'git',
      ['diff', '--staged', '-U0', '--no-ext-diff'],
      {
        cwd: root,
        env,
        encoding: 'utf8',
      },
    ).stdout;
    const findings = [];
    let file = '';
    let line = 0;
    for (const text of diff.split('\n')) {
      if (text.startsWith('+++ b/')) file = text.slice(6);
      const hunk = /^@@ -\S+ \+(\d+)/.exec(text);
      if (hunk) line = Number(hunk[1]) - 1;
      if (text.startsWith('+') && !text.startsWith('+++')) {
        line++;
        if (text.includes(token)) {
          findings.push({ RuleID: 'github-pat', File: file, StartLine: line });
        }
      }
    }
    return { findings };
  };

describe('scanPlan', () => {
  it('refuses, instead of passing, when the folder is not inside a git work tree', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'helmstead-not-a-repo-'));
    try {
      expect(() =>
        scanPlan(
          { cwd: outside, mode: 'staged', paths: [] },
          fakeGitleaks('unused'),
        ),
      ).toThrow(/not inside a git work tree/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('finds a staged token', () => {
    const token = fakeToken();
    writeFileSync(
      path.join(repo, 'secret.ts'),
      `export const t = '${token}';\n`,
    );
    git(repo, 'add', 'secret.ts');

    const { findings } = scanPlan(
      planScan('git commit -m x', repo)!,
      fakeGitleaks(token),
    );

    expect(findings).toEqual([
      { RuleID: 'github-pat', File: 'secret.ts', StartLine: 1 },
    ]);
  });

  it('with -a, finds a token in an unstaged change to a tracked file, and leaves the index alone', () => {
    const token = fakeToken();
    writeFileSync(
      path.join(repo, 'config.ts'),
      `export const port = 5108;\nexport const t = '${token}';\n`,
    );
    const index = readFileSync(path.join(repo, '.git/index'));

    expect(
      scanPlan(planScan('git commit -m x', repo)!, fakeGitleaks(token))
        .findings,
    ).toEqual([]);
    expect(
      scanPlan(planScan('git commit -a -m x', repo)!, fakeGitleaks(token))
        .findings,
    ).toEqual([{ RuleID: 'github-pat', File: 'config.ts', StartLine: 2 }]);
    expect(readFileSync(path.join(repo, '.git/index'))).toEqual(index);
  });

  it('with <paths>, scans the working tree of those paths', () => {
    const token = fakeToken();
    writeFileSync(path.join(repo, 'new.ts'), `const t = '${token}';\n`);

    expect(
      scanPlan(planScan('git commit -m x new.ts', repo)!, fakeGitleaks(token))
        .findings,
    ).toEqual([{ RuleID: 'github-pat', File: 'new.ts', StartLine: 1 }]);
  });

  it('finds nothing in a clean change', () => {
    writeFileSync(path.join(repo, 'config.ts'), 'export const port = 5109;\n');

    expect(
      scanPlan(planScan('git commit -a -m x', repo)!, fakeGitleaks(fakeToken()))
        .findings,
    ).toEqual([]);
  });
});

describe('blockMessage', () => {
  it('names rule, file and line, and never the secret', () => {
    const message = blockMessage([
      {
        RuleID: 'github-pat',
        File: 'src/a.ts',
        StartLine: 3,
        Fingerprint: 'src/a.ts:github-pat:3',
      },
    ]);

    expect(message).toContain('rule github-pat in src/a.ts line 3');
    expect(message).toContain('.gitleaksignore');
  });
});

const runHook = (command: string, cwd: string) =>
  spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_input: { command }, cwd }),
    encoding: 'utf8',
  });

describe('the hook process', () => {
  it('lets every command that is not a commit through without scanning', () => {
    const run = runHook('git status && npm test', repo);

    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
  });

  // These run the real pinned gitleaks. CI downloads it before the tests (`node tools/supply-chain/cli.mjs
  // gitleaks-path`) and sets HELMSTEAD_REQUIRE_GITLEAKS=1, so there they cannot be skipped. Tests never download.
  const available = Boolean(cachedGitleaks());
  if (process.env['HELMSTEAD_REQUIRE_GITLEAKS'] === '1') {
    it('has the pinned gitleaks available', () => {
      expect(available).toBe(true);
    });
  }

  describe.runIf(available)('with the real gitleaks', () => {
    it('blocks a commit with a staged token, without printing it', () => {
      const token = fakeToken();
      writeFileSync(
        path.join(repo, 'secret.ts'),
        `export const t = '${token}';\n`,
      );
      git(repo, 'add', 'secret.ts');

      const run = runHook('git commit -m "add secret"', repo);

      expect(run.status).toBe(2);
      expect(run.stderr).toContain('rule github-pat in secret.ts line 1');
      expect(run.stderr + run.stdout).not.toContain(token);
    });

    it('blocks git commit -a when the token is only in the working tree', () => {
      const token = fakeToken();
      writeFileSync(
        path.join(repo, 'config.ts'),
        `export const t = '${token}';\n`,
      );

      expect(runHook('git commit -m x', repo).status).toBe(0);
      const run = runHook('git commit -a -m x', repo);
      expect(run.status).toBe(2);
      expect(run.stderr).toContain('config.ts line 1');
      expect(run.stderr + run.stdout).not.toContain(token);
    });

    it('lets a clean change through', () => {
      writeFileSync(
        path.join(repo, 'config.ts'),
        'export const port = 5109;\n',
      );

      expect(runHook('git commit -a -m x', repo).status).toBe(0);
    });
  });
});
