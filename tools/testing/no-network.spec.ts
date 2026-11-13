import { spawnSync } from 'node:child_process';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net, { type AddressInfo } from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { pathToFileURL } from 'node:url';
import { request as namedRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GUARD, isLoopback, shouldGuard } from './no-network';

// TEST-NET-1 (RFC 5737): documentation space that is never routed, so even a guard that failed open would not
// reach a real host.
const TEST_NET = '192.0.2.1';
const blocked = new RegExp(
  `"${TEST_NET.replace(/\./g, '\\.')}" is blocked in tests.*plan §9`,
  'is',
);

describe('the network guard (loaded as a Vitest setup file)', () => {
  it('is installed in this run', () => {
    expect(
      (net.Socket.prototype.connect as unknown as Record<symbol, unknown>)[
        GUARD
      ],
    ).toBe(true);
  });

  it('blocks net.Socket#connect to a non-loopback address', () => {
    const socket = new net.Socket();
    expect(() => socket.connect(80, TEST_NET)).toThrow(blocked);
    expect(() => net.connect({ host: TEST_NET, port: 80 })).toThrow(blocked);
    expect(() => net.createConnection(80, TEST_NET)).toThrow(blocked);
    socket.destroy();
  });

  it('blocks a "localhost" connection with a custom resolver, which could map it anywhere', () => {
    const lookup = () => undefined;
    expect(() => net.connect({ host: 'localhost', port: 80, lookup })).toThrow(
      /custom lookup/,
    );
  });

  it('blocks tls.connect to a non-loopback address', () => {
    expect(() => tls.connect({ host: TEST_NET, port: 443 })).toThrow(blocked);
    expect(() => tls.connect(443, TEST_NET)).toThrow(blocked);
  });

  it('blocks http.request, http.get and https.request', () => {
    expect(() => http.request(`http://${TEST_NET}/`)).toThrow(blocked);
    expect(() => http.get({ host: TEST_NET, path: '/' })).toThrow(blocked);
    expect(() => https.request(`https://${TEST_NET}/`)).toThrow(blocked);
    expect(() => namedRequest({ hostname: TEST_NET })).toThrow(blocked);
    expect(() =>
      http.request('http://127.0.0.1/', { hostname: TEST_NET }),
    ).toThrow(blocked);
  });

  it('blocks global fetch', () => {
    expect(() => fetch(`http://${TEST_NET}/`)).toThrow(blocked);
    expect(() => fetch(new URL(`https://${TEST_NET}/x`))).toThrow(blocked);
    expect(() => fetch(new Request(`http://${TEST_NET}/`))).toThrow(blocked);
  });

  it('blocks DNS lookups of any name other than localhost', async () => {
    expect(() => dns.lookup('example.com', () => undefined)).toThrow(
      /"example\.com" is blocked/,
    );
    expect(() => dns.resolve4('example.com', () => undefined)).toThrow(
      /is blocked/,
    );
    expect(() => dns.promises.lookup('example.com')).toThrow(/is blocked/);
    expect(() => new dns.promises.Resolver().resolveTxt('example.com')).toThrow(
      /is blocked/,
    );
    expect(() =>
      new dns.Resolver().resolve6('example.com', () => undefined),
    ).toThrow(/is blocked/);
    await expect(dns.promises.lookup('localhost')).resolves.toBeDefined();
  });

  describe('on loopback', () => {
    let server: http.Server;
    let port: number;
    beforeAll(async () => {
      server = http.createServer((_, response) => response.end('fixture'));
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', () => resolve()),
      );
      port = (server.address() as AddressInfo).port;
    });
    afterAll(() => new Promise((resolve) => server.close(resolve)));

    it('allows fetch and http to 127.0.0.1 and localhost', async () => {
      expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe(
        'fixture',
      );
      const body = await new Promise<string>((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port, path: '/' }, (response) => {
            let text = '';
            response.on('data', (chunk) => (text += chunk));
            response.on('end', () => resolve(text));
          })
          .on('error', reject);
      });
      expect(body).toBe('fixture');
    });
  });

  it.each([
    ['127.0.0.1', true],
    ['127.255.0.9', true],
    ['::1', true],
    ['[::1]', true],
    ['localhost', true],
    ['LOCALHOST', true],
    [undefined, true],
    ['192.0.2.1', false],
    ['10.0.0.1', false],
    ['0.0.0.0', false],
    ['::', false],
    ['example.com', false],
    ['localhost.example.com', false],
  ])('treats %s as loopback: %s', (host, expected) => {
    expect(isLoopback(host)).toBe(expected);
  });
});

describe('the live-test escape hatch', () => {
  it('lifts the guard only when HELMSTEAD_LIVE_TESTS is exactly "1"', () => {
    expect(shouldGuard({})).toBe(true);
    expect(shouldGuard({ HELMSTEAD_LIVE_TESTS: '0' })).toBe(true);
    expect(shouldGuard({ HELMSTEAD_LIVE_TESTS: 'true' })).toBe(true);
    expect(shouldGuard({ HELMSTEAD_LIVE_TESTS: '1' })).toBe(false);
  });

  // The setup file in a plain Node process: guarded by default, not guarded with the variable. It only inspects the
  // patched functions, so no connection is attempted either way.
  const probe = (env: NodeJS.ProcessEnv) =>
    spawnSync(
      process.execPath,
      [
        '--import',
        // A file: URL, since --import does not take a Windows drive path.
        pathToFileURL(path.join(import.meta.dirname, 'no-network.ts')).href,
        '-e',
        "process.stdout.write(String(Boolean(require('node:net').Socket.prototype.connect[Symbol.for('helmstead.noNetworkGuard')])))",
      ],
      { env: { ...process.env, ...env, NODE_OPTIONS: '' }, encoding: 'utf8' },
    );

  it('installs the guard in a process without the variable', () => {
    const run = probe({ HELMSTEAD_LIVE_TESTS: '' });
    expect(run.stdout, run.stderr).toBe('true');
  });

  it('does not install it with HELMSTEAD_LIVE_TESTS=1', () => {
    const run = probe({ HELMSTEAD_LIVE_TESTS: '1' });
    expect(run.stdout, run.stderr).toBe('false');
  });
});
