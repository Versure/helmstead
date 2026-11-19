#!/usr/bin/env node
// `npx nx serve core` (spec 004 criterion 17): starts the core with a fresh session token for this run.
//
// 1. 32 random bytes from crypto.randomBytes, base64url-encoded.
// 2. Written to .helmstead/dev-session-token (mode 0600, replaced on every start) for the web dev server's proxy.
// 3. The core started with HELMSTEAD_SESSION_TOKEN set; the core reads the variable and removes it.
// 4. The file deleted when the core exits.
// The token is never printed.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '../..');

/**
 * Read by the web dev server's proxy (apps/web/proxy.conf.mjs) on every request. `.helmstead/` is ignored by git; the
 * file is readable by the user only (mode 0600, which Node cannot enforce on Windows).
 */
export const TOKEN_FILE = path.join(
  repoRoot,
  '.helmstead',
  'dev-session-token',
);

export const DOTNET = {
  command: 'dotnet',
  args: ['run', '--launch-profile', 'http'],
  cwd: path.join(repoRoot, 'apps/core/src/Helmstead.Core.Api'),
};

/** A new session token: 32 random bytes as base64url (43 characters, no padding). */
export function createToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Writes the token for the dev proxy. The file is removed first, so it is always created anew with mode 0600 (an
 * existing file would keep its old mode); `wx` refuses to follow anything put in its place in between.
 */
export function writeTokenFile(file, token) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  rmSync(file, { force: true });
  writeFileSync(file, token, { mode: 0o600, flag: 'wx' });
}

/** Deletes the file, but only while it still holds this run's token: a newer run may have replaced it. */
export function removeTokenFile(file, token) {
  try {
    if (readFileSync(file, 'utf8') === token) rmSync(file, { force: true });
  } catch {
    // Already gone.
  }
}

/**
 * Runs the core (or `run.command` in tests) with a fresh token and resolves with its exit code. Signals that stop
 * this launcher are passed on to the core, and the token file is removed when the core exits.
 */
export function serveCore(
  { command, args, cwd } = DOTNET,
  tokenFile = TOKEN_FILE,
) {
  const token = createToken();
  writeTokenFile(tokenFile, token);
  const cleanUp = () => removeTokenFile(tokenFile, token);
  process.once('exit', cleanUp);

  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, HELMSTEAD_SESSION_TOKEN: token },
  });
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const forward = (signal) => child.kill(signal);
  for (const signal of signals) process.on(signal, forward);

  return new Promise((resolve) => {
    const done = (code) => {
      for (const signal of signals) process.off(signal, forward);
      process.off('exit', cleanUp);
      cleanUp();
      resolve(code);
    };
    child.once('error', (error) => {
      console.error(`Could not start the core (${command}): ${error.message}`);
      done(1);
    });
    child.once('exit', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await serveCore();
}
