import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import proxyConfig, {
  CORE_ORIGIN,
  coreProxy,
  TOKEN_FILE,
} from '../../apps/web/proxy.conf.mjs';
import { TOKEN_FILE as LAUNCHER_TOKEN_FILE } from './serve-core.mjs';

// Spec 004 criterion 18: the proxy's request rewriting, with a temporary token file and without one.
describe('the dev proxy to the core', () => {
  let dir: string;
  let tokenFile: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'helmstead-dev-proxy-'));
    tokenFile = path.join(dir, 'dev-session-token');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const request = (headers: Record<string, string> = {}) =>
    ({
      url: '/health',
      headers: {
        host: '127.0.0.1:4200',
        origin: 'http://127.0.0.1:4200',
        ...headers,
      },
    }) as unknown as IncomingMessage;

  const response = () => {
    const res = {
      status: 0,
      body: '',
      writeHead(status: number) {
        res.status = status;
        return res;
      },
      end(body = '') {
        res.body = body;
        return res;
      },
    };
    return res;
  };

  it('adds the token, sets Host to the core and removes Origin', () => {
    const token = randomBytes(32).toString('base64url');
    writeFileSync(tokenFile, token);
    const req = request({ authorization: 'Bearer from-the-browser' });
    const res = response();

    const result = coreProxy({ tokenFile }).bypass(
      req,
      res as unknown as ServerResponse,
    );

    expect(result).toBeUndefined();
    expect(res.status).toBe(0);
    expect(req.headers.authorization).toBe(`Bearer ${token}`);
    expect(req.headers.host).toBe('127.0.0.1:5108');
    expect(req.headers.origin).toBeUndefined();
  });

  it('reads the file on each request, so a restarted core works without restarting the proxy', () => {
    const proxy = coreProxy({ tokenFile });
    const first = randomBytes(32).toString('base64url');
    const second = randomBytes(32).toString('base64url');

    writeFileSync(tokenFile, first);
    const a = request();
    proxy.bypass(a, response() as unknown as ServerResponse);
    writeFileSync(tokenFile, second);
    const b = request();
    proxy.bypass(b, response() as unknown as ServerResponse);

    expect(a.headers.authorization).toBe(`Bearer ${first}`);
    expect(b.headers.authorization).toBe(`Bearer ${second}`);
  });

  it('answers 502 without the file, and says once that the core must run', () => {
    const warn = vi.fn();
    const proxy = coreProxy({ tokenFile, warn });

    const req = request();
    const res = response();
    const result = proxy.bypass(req, res as unknown as ServerResponse);
    proxy.bypass(request(), response() as unknown as ServerResponse);

    // A string tells Vite to skip the proxy for a request whose response has already ended.
    expect(result).toBe('/health');
    expect(res.status).toBe(502);
    expect(req.headers.authorization).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('npx nx serve core');
  });

  it.each([
    ['another origin', { origin: 'https://example.com' }],
    ['the literal null origin', { origin: 'null' }],
    [
      'a cross-site fetch without Origin',
      { origin: '', 'sec-fetch-site': 'cross-site' },
    ],
    [
      'a same-site fetch from another port',
      { origin: '', 'sec-fetch-site': 'same-site' },
    ],
  ])('refuses %s with 403 and adds no token', (_, headers) => {
    writeFileSync(tokenFile, randomBytes(32).toString('base64url'));
    const req = request(headers);
    if (headers.origin === '') delete req.headers.origin;
    const res = response();

    const result = coreProxy({ tokenFile }).bypass(
      req,
      res as unknown as ServerResponse,
    );

    expect(result).toBe('/health');
    expect(res.status).toBe(403);
    expect(req.headers.authorization).toBeUndefined();
  });

  it.each([
    ['its own origin', { 'sec-fetch-site': 'same-origin' }],
    ['a typed address', { 'sec-fetch-site': 'none' }],
  ])('forwards a request from %s', (_, headers) => {
    writeFileSync(tokenFile, randomBytes(32).toString('base64url'));
    const req = request(headers);

    expect(
      coreProxy({ tokenFile }).bypass(
        req,
        response() as unknown as ServerResponse,
      ),
    ).toBeUndefined();
    expect(req.headers.authorization).toMatch(/^Bearer /);
  });

  it('reads the file the launcher writes', () => {
    expect(TOKEN_FILE).toBe(LAUNCHER_TOKEN_FILE);
    expect(TOKEN_FILE).toBe(
      path.resolve(import.meta.dirname, '../../.helmstead/dev-session-token'),
    );
  });

  it('forwards only to the core at 127.0.0.1:5108', () => {
    expect(CORE_ORIGIN).toBe('http://127.0.0.1:5108');
    const entries = Object.values(
      proxyConfig as Record<string, { target: string; changeOrigin: boolean }>,
    );

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.target).toBe(CORE_ORIGIN);
      expect(entry.changeOrigin).toBe(false);
    }
  });
});
