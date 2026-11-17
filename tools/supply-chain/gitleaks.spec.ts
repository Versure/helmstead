import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultCacheDir,
  downloadFile,
  cachedGitleaks,
  ensureGitleaks,
  loadPin,
  runGitleaks,
  sha256,
} from './gitleaks.mjs';

const windows = process.platform === 'win32';
const FAKE_BINARY = '#!/bin/sh\necho 8.30.1\n';
const key = `${process.platform}-${process.arch}`;

// A stand-in "gitleaks": a shell script that prints the pinned version. It is packed into a .tar.gz at runtime and
// served from loopback, so the tests need no network and no real release.
let work: string;
let archive: Buffer;
let server: Server;
let requests = 0;
let baseUrl: string;

beforeAll(async () => {
  work = mkdtempSync(path.join(tmpdir(), 'helmstead-gitleaks-test-'));
  const src = path.join(work, 'src');
  mkdirSync(src);
  writeFileSync(path.join(src, 'gitleaks'), FAKE_BINARY, { mode: 0o755 });
  const tar = windows
    ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  const packed = path.join(work, 'fixture.tar.gz');
  const run = spawnSync(tar, ['-czf', packed, '-C', src, 'gitleaks']);
  expect(run.status).toBe(0);
  archive = readFileSync(packed);

  server = createServer((request, response) => {
    requests++;
    response.end(request.url === '/fixture.tar.gz' ? archive : '');
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(work, { recursive: true, force: true });
});

let cacheDir: string;
beforeEach(() => {
  requests = 0;
  cacheDir = mkdtempSync(path.join(work, 'cache-'));
});

const pin = (
  sha = sha256(archive),
  url = `${baseUrl}/fixture.tar.gz`,
  binarySha = sha256(Buffer.from(FAKE_BINARY)),
) => ({
  version: '8.30.1',
  assets: {
    [key]: { url, sha256: sha, binarySha256: binarySha, binary: 'gitleaks' },
  },
});

describe('ensureGitleaks', () => {
  it('downloads, verifies and caches the pinned release when it is not on the PATH', async () => {
    const binary = await ensureGitleaks({
      pin: pin(),
      cacheDir,
      searchPath: '',
    });

    expect(binary.startsWith(cacheDir)).toBe(true);
    expect(readFileSync(binary, 'utf8')).toContain('echo 8.30.1');
    expect(requests).toBe(1);
    if (!windows) {
      expect(spawnSync(binary, ['version'], { encoding: 'utf8' }).stdout).toBe(
        '8.30.1\n',
      );
    }
  });

  it('blocks on a checksum mismatch, keeps nothing and runs nothing', async () => {
    const wrong = sha256(Buffer.from('not the archive'));

    await expect(
      ensureGitleaks({ pin: pin(wrong), cacheDir, searchPath: '' }),
    ).rejects.toThrow(
      /does not match its pinned checksum.*deleted and not run/,
    );
    const folder = path.join(cacheDir, 'gitleaks', '8.30.1', key);
    expect(readdirSync(folder)).toEqual([]);
  });

  it('blocks with a clear message when offline and nothing is cached', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, '127.0.0.1', () => resolve()),
    );
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));

    await expect(
      ensureGitleaks({
        pin: pin(undefined, `http://127.0.0.1:${port}/fixture.tar.gz`),
        cacheDir,
        searchPath: '',
      }),
    ).rejects.toThrow(/Could not download gitleaks.*offline.*stays blocked/s);
  });

  it('reuses the cached binary without a request', async () => {
    const first = await ensureGitleaks({
      pin: pin(),
      cacheDir,
      searchPath: '',
    });
    requests = 0;

    const second = await ensureGitleaks({
      pin: pin(),
      cacheDir,
      searchPath: '',
    });

    expect(second).toBe(first);
    expect(requests).toBe(0);
  });

  it('downloads again when the cached binary was changed after caching', async () => {
    const binary = await ensureGitleaks({
      pin: pin(),
      cacheDir,
      searchPath: '',
    });
    writeFileSync(binary, '#!/bin/sh\necho tampered\n');
    requests = 0;

    await ensureGitleaks({ pin: pin(), cacheDir, searchPath: '' });

    expect(requests).toBe(1);
    expect(readFileSync(binary, 'utf8')).toContain('echo 8.30.1');
  });

  it('uses a gitleaks on the PATH only when it is the pinned binary', async () => {
    const bin = mkdtempSync(path.join(work, 'path-'));
    writeFileSync(path.join(bin, 'gitleaks'), FAKE_BINARY, { mode: 0o755 });

    expect(
      await ensureGitleaks({ pin: pin(), cacheDir, searchPath: bin }),
    ).toBe(path.join(bin, 'gitleaks'));
    expect(requests).toBe(0);

    // Same version string, different binary (a stub that would always pass): not trusted.
    writeFileSync(
      path.join(bin, 'gitleaks'),
      '#!/bin/sh\necho 8.30.1\nexit 0\n',
      {
        mode: 0o755,
      },
    );
    expect(
      await ensureGitleaks({ pin: pin(), cacheDir, searchPath: bin }),
    ).not.toBe(path.join(bin, 'gitleaks'));
    expect(requests).toBe(1);
  });

  it('does not trust a cached binary swapped together with anything next to it', async () => {
    const binary = await ensureGitleaks({
      pin: pin(),
      cacheDir,
      searchPath: '',
    });
    writeFileSync(binary, '#!/bin/sh\nexit 0\n');
    writeFileSync(`${binary}.sha256`, `${sha256(readFileSync(binary))}\n`);

    expect(
      cachedGitleaks({ pin: pin(), cacheDir, searchPath: '' }),
    ).toBeUndefined();
  });

  it('blocks when the extracted binary is not the pinned one, and keeps nothing', async () => {
    const wrongBinary = pin(undefined, undefined, sha256(Buffer.from('other')));

    await expect(
      ensureGitleaks({ pin: wrongBinary, cacheDir, searchPath: '' }),
    ).rejects.toThrow(/does not match its pinned binarySha256/);
    expect(readdirSync(path.join(cacheDir, 'gitleaks', '8.30.1', key))).toEqual(
      [],
    );
  });

  it.skipIf(windows)(
    'treats a gitleaks error as a failed scan, even when it wrote an empty report',
    () => {
      const bin = mkdtempSync(path.join(work, 'failing-'));
      const fake = path.join(bin, 'gitleaks');
      // Like gitleaks after a partial scan: writes "[]" to --report-path, then exits 1.
      writeFileSync(
        fake,
        '#!/bin/sh\nfor a in "$@"; do case "$a" in --report-path=*) echo "[]" > "${a#--report-path=}";; esac; done\necho "partial scan" >&2\nexit 1\n',
        { mode: 0o755 },
      );

      expect(() => runGitleaks(fake, ['git', work])).toThrow(
        /gitleaks failed \(exit 1/,
      );
    },
  );

  it('fails for a platform without a pinned release', async () => {
    await expect(
      ensureGitleaks({ pin: pin(), cacheDir, searchPath: '', arch: 'mips' }),
    ).rejects.toThrow(/No pinned gitleaks release/);
  });

  it('follows redirects when downloading', async () => {
    const redirecting = createServer((request, response) => {
      response.writeHead(302, { location: `${baseUrl}/fixture.tar.gz` });
      response.end();
    });
    await new Promise<void>((resolve) =>
      redirecting.listen(0, '127.0.0.1', () => resolve()),
    );
    const port = (redirecting.address() as AddressInfo).port;
    try {
      expect(sha256(await downloadFile(`http://127.0.0.1:${port}/asset`))).toBe(
        sha256(archive),
      );
    } finally {
      await new Promise((resolve) => redirecting.close(resolve));
    }
  });

  it('caches outside the repository', () => {
    const relative = path.relative(
      path.resolve(import.meta.dirname, '../..'),
      defaultCacheDir(),
    );
    // Outside means "up from the repository", or another drive on Windows, where the result is absolute.
    expect(relative.startsWith('..') || path.isAbsolute(relative)).toBe(true);
  });
});

describe('the pinned release', () => {
  const real = loadPin();

  it('covers Windows, macOS and Linux on x64 and arm64', () => {
    expect(Object.keys(real.assets).sort()).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
      'win32-arm64',
      'win32-x64',
    ]);
  });

  it('downloads only from the official gitleaks/gitleaks GitHub release of the pinned version', () => {
    const prefix = `https://github.com/gitleaks/gitleaks/releases/download/v${real.version}/gitleaks_${real.version}_`;
    for (const asset of Object.values(
      real.assets as Record<string, { url: string; sha256: string }>,
    )) {
      expect(asset.url.startsWith(prefix)).toBe(true);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect((asset as { binarySha256: string }).binarySha256).toMatch(
        /^[0-9a-f]{64}$/,
      );
    }
    expect(existsSync(path.join(import.meta.dirname, 'gitleaks.json'))).toBe(
      true,
    );
  });
});
