/// <reference types="node" />
// Vitest setup file for every test run in the workspace (spec 003 criterion 13): tests may not reach the network
// (plan §9: no live API calls in tests; use recorded fixtures). Loopback stays allowed, so a test can still serve a
// fixture from 127.0.0.1. It patches the Node APIs every HTTP client ends up in (net and tls sockets, http(s).request,
// global fetch) and DNS, so a library cannot go around it by using a lower level.
//
// The escape hatch is HELMSTEAD_LIVE_TESTS=1, for tests named *.live.spec.ts, which no normal run includes.
// tools/workspace/no-network.spec.ts checks that every test target loads this file.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import tls from 'node:tls';

export const GUARD = Symbol.for('helmstead.noNetworkGuard');

/** Whether the guard applies: always, unless HELMSTEAD_LIVE_TESTS is exactly "1". */
export function shouldGuard(env: Record<string, string | undefined>): boolean {
  return env['HELMSTEAD_LIVE_TESTS'] !== '1';
}

export function isLoopback(host: string | undefined | null): boolean {
  // Node connects to localhost when no host is given.
  if (host === undefined || host === null || host === '') return true;
  const name = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (isIP(name) === 4) return name.startsWith('127.');
  if (isIP(name) === 6) {
    return (
      name === '::1' || /^::ffff:127\./.test(name) || name === '0:0:0:0:0:0:0:1'
    );
  }
  return false;
}

export class NetworkAccessError extends Error {
  constructor(host: string, api: string) {
    super(
      `${api} to "${host}" is blocked in tests. Plan §9: tests make no live calls; use a recorded fixture or a ` +
        'server on 127.0.0.1. A test that really needs a live API is named *.live.spec.ts and runs only with ' +
        'HELMSTEAD_LIVE_TESTS=1 (tools/testing/no-network.ts).',
    );
    this.name = 'NetworkAccessError';
  }
}

function check(host: string | undefined | null, api: string): void {
  if (!isLoopback(host)) throw new NetworkAccessError(String(host), api);
}

type AnyFunction = (...args: never[]) => unknown;

function mark<T extends AnyFunction>(fn: T): T {
  Object.defineProperty(fn, GUARD, { value: true });
  return fn;
}

function hostOfUrl(url: unknown): string | undefined {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return undefined;
  }
}

/** The host of http.request(url | options, ...) and net/tls connect(options | port, host). */
function hostOfRequest(args: unknown[]): string | undefined {
  const [first, second] = args;
  if (typeof first === 'string' || first instanceof URL) {
    const host = hostOfUrl(first);
    // request(url, options) lets options override the host.
    if (second && typeof second === 'object') {
      const o = second as { hostname?: string; host?: string };
      return o.hostname ?? o.host ?? host;
    }
    return host;
  }
  if (first && typeof first === 'object') {
    const o = first as {
      hostname?: string;
      host?: string;
      path?: string;
      socketPath?: string;
    };
    if (o.socketPath) return 'localhost';
    return o.hostname ?? o.host?.replace(/:\d+$/, '');
  }
  return undefined;
}

function connectHost(args: unknown[]): string | undefined {
  const [first, second] = args;
  // connect([options]) with a list from net internals, connect(options), connect(path) or connect(port, host).
  const options = Array.isArray(first) ? first[0] : first;
  if (options && typeof options === 'object') {
    const o = options as { host?: string; path?: string };
    if (o.path) return 'localhost'; // a Unix socket or named pipe never leaves the machine
    return o.host;
  }
  if (typeof options === 'string' && Number.isNaN(Number(options)))
    return 'localhost'; // IPC path
  return typeof second === 'string' ? second : undefined;
}

const DNS_METHODS = [
  'lookup',
  'lookupService',
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTlsa',
  'resolveTxt',
  'reverse',
] as const;

function guardDns(target: Record<string, unknown>, label: string): void {
  for (const method of DNS_METHODS) {
    const original = target[method];
    if (
      typeof original !== 'function' ||
      (original as unknown as Record<symbol, unknown>)[GUARD]
    )
      continue;
    target[method] = mark(function (this: unknown, ...args: unknown[]) {
      const name = String(args[0]);
      // Only localhost resolves; an IP literal is not a lookup, but it must still be loopback.
      if (
        method === 'reverse' ||
        method === 'lookupService' ||
        !isLoopback(name)
      ) {
        throw new NetworkAccessError(name, `${label}.${method}`);
      }
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    });
  }
}

/** Installs the guard once per process. @returns whether it is installed */
export function installNetworkGuard(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!shouldGuard(env)) return false;
  if (
    (net.Socket.prototype.connect as unknown as Record<symbol, unknown>)[GUARD]
  )
    return true;

  const socketConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = mark(function (
    this: net.Socket,
    ...args: unknown[]
  ) {
    check(connectHost(args), 'net.Socket#connect');
    return (socketConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  }) as typeof socketConnect;

  const tlsConnect = tls.connect;
  tls.connect = mark((...args: unknown[]) => {
    const [first, second] = args;
    const host =
      first && typeof first === 'object'
        ? (first as { host?: string; path?: string }).path
          ? 'localhost'
          : (first as { host?: string }).host
        : typeof second === 'string'
          ? second
          : undefined;
    check(host, 'tls.connect');
    return (tlsConnect as (...a: unknown[]) => tls.TLSSocket)(...args);
  }) as typeof tlsConnect;

  for (const [label, module] of [
    ['http', http],
    ['https', https],
  ] as const) {
    for (const method of ['request', 'get'] as const) {
      const original = module[method];
      (module as unknown as Record<string, unknown>)[method] = mark(
        (...args: unknown[]) => {
          check(hostOfRequest(args), `${label}.${method}`);
          return (original as (...a: unknown[]) => unknown)(...args);
        },
      );
    }
  }

  guardDns(dns as unknown as Record<string, unknown>, 'dns');
  guardDns(dns.promises as unknown as Record<string, unknown>, 'dns.promises');
  guardDns(
    dns.Resolver.prototype as unknown as Record<string, unknown>,
    'dns.Resolver',
  );
  guardDns(
    dns.promises.Resolver.prototype as unknown as Record<string, unknown>,
    'dns.promises.Resolver',
  );

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === 'function') {
    globalThis.fetch = mark(
      (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url =
          typeof input === 'string' || input instanceof URL
            ? String(input)
            : input.url;
        const host = hostOfUrl(url);
        // A relative URL (jsdom) resolves against the test page on localhost.
        if (host !== undefined) check(host, 'fetch');
        return originalFetch(input, init);
      },
    ) as typeof fetch;
  }

  // ES module named imports of builtins (import { request } from 'node:http') read these copies.
  syncBuiltinESMExports();
  return true;
}

installNetworkGuard();
