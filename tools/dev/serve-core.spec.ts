import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createToken,
  DOTNET,
  removeTokenFile,
  serveCore,
  writeTokenFile,
} from './serve-core.mjs';

// Spec 004 criterion 17. A stub stands in for `dotnet run`: a Node script that records what it was given into a
// report file, so the test can compare it with the token file without the launcher ever printing anything.
const windows = process.platform === 'win32';
const launcher = path.join(import.meta.dirname, 'serve-core.mjs');

const STUB = `
const { readFileSync, writeFileSync } = require('node:fs');
const [report, tokenFile, exitCode] = process.argv.slice(2);
writeFileSync(report, JSON.stringify({
  token: process.env.HELMSTEAD_SESSION_TOKEN ?? null,
  file: readFileSync(tokenFile, 'utf8'),
}));
process.exit(Number(exitCode));
`;

describe('the dev launcher of the core', () => {
  let dir: string;
  let tokenFile: string;
  let report: string;
  let stub: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'helmstead-serve-core-'));
    tokenFile = path.join(dir, '.helmstead', 'dev-session-token');
    report = path.join(dir, 'report.json');
    stub = path.join(dir, 'stub.cjs');
    writeFileSync(stub, STUB);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (exitCode = 0) =>
    serveCore(
      {
        command: process.execPath,
        args: [stub, report, tokenFile, String(exitCode)],
        cwd: dir,
      },
      tokenFile,
    );
  const reported = () =>
    JSON.parse(readFileSync(report, 'utf8')) as {
      token: string | null;
      file: string;
    };

  it('makes 32 random bytes as base64url', () => {
    const token = createToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(createToken()).not.toBe(token);
  });

  it('starts the core with the token in HELMSTEAD_SESSION_TOKEN and the same token in the file', async () => {
    await run();

    const { token, file } = reported();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(file).toBe(token);
  });

  it('makes a new token on every start', async () => {
    await run();
    const first = reported().token;
    await run();

    expect(reported().token).not.toBe(first);
  });

  it('deletes the file when the core exits, and passes on its exit code', async () => {
    expect(await run(3)).toBe(3);

    expect(existsSync(tokenFile)).toBe(false);
  });

  it.skipIf(windows)('creates the file with mode 0600', () => {
    writeTokenFile(tokenFile, createToken());

    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
  });

  it.skipIf(windows)(
    'replaces an existing file, and its loose mode, on every start',
    () => {
      writeTokenFile(tokenFile, createToken());
      const fresh = createToken();
      writeFileSync(tokenFile, 'stale', { mode: 0o644 });

      writeTokenFile(tokenFile, fresh);

      expect(readFileSync(tokenFile, 'utf8')).toBe(fresh);
      expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
    },
  );

  it('leaves a file that a newer run has replaced', () => {
    const ours = createToken();
    const newer = createToken();
    writeTokenFile(tokenFile, newer);

    removeTokenFile(tokenFile, ours);

    expect(readFileSync(tokenFile, 'utf8')).toBe(newer);
  });

  it('never prints the token', () => {
    const script = `
      import { serveCore } from ${JSON.stringify(path.toNamespacedPath(launcher).replaceAll('\\', '/'))};
      process.exitCode = await serveCore(
        { command: process.execPath, args: ${JSON.stringify([stub, report, tokenFile, '0'])}, cwd: ${JSON.stringify(dir)} },
        ${JSON.stringify(tokenFile)},
      );`;

    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);
    const { token } = reported();
    expect(token).toBeTruthy();
    expect(result.stdout + result.stderr).not.toContain(token);
  });

  // `dotnet run` ignores a SIGINT that reaches only itself: it waits for the app, which in a terminal gets the signal
  // from the process group. This stub behaves the same, so the launcher must signal the core's whole group.
  it.skipIf(windows)(
    'stops the whole core, app included, when it is stopped itself, and deletes the file',
    async () => {
      const pids = path.join(dir, 'pids.json');
      const runner = path.join(dir, 'runner.cjs');
      writeFileSync(
        runner,
        `
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
process.on('SIGINT', () => {});
const app = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
app.on('exit', () => process.exit(0));
writeFileSync(${JSON.stringify(pids)}, JSON.stringify({ runner: process.pid, app: app.pid }));
`,
      );
      const script = `
        import { serveCore } from ${JSON.stringify(launcher.replaceAll('\\', '/'))};
        process.exitCode = await serveCore(
          { command: process.execPath, args: [${JSON.stringify(runner)}], cwd: ${JSON.stringify(dir)} },
          ${JSON.stringify(tokenFile)},
        );`;
      const launched = spawn(
        process.execPath,
        ['--input-type=module', '-e', script],
        { stdio: 'ignore' },
      );
      const exited = new Promise((resolve) => launched.once('exit', resolve));
      await waitFor(() => existsSync(pids));
      const { runner: runnerPid, app } = JSON.parse(
        readFileSync(pids, 'utf8'),
      ) as { runner: number; app: number };
      expect(existsSync(tokenFile)).toBe(true);

      launched.kill('SIGINT');
      await exited;

      await waitFor(() => !alive(app) && !alive(runnerPid));
      expect(existsSync(tokenFile)).toBe(false);
    },
  );

  it('runs the core with dotnet from its project folder', () => {
    expect(DOTNET.command).toBe('dotnet');
    expect(DOTNET.args).toEqual(['run', '--launch-profile', 'http']);
    expect(DOTNET.cwd).toMatch(
      /apps[\\/]core[\\/]src[\\/]Helmstead\.Core\.Api$/,
    );
  });
});

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, timeout = 15_000) {
  const until = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > until) throw new Error('Timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
