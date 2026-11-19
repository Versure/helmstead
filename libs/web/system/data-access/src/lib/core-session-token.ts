import { InjectionToken } from '@angular/core';

/**
 * The session token the core requires on every request (spec 004, ADR-006), or `null` when the app does not hold one.
 * `null` by default: in development the dev server's proxy (apps/web/proxy.conf.mjs) adds the token, so the browser
 * never sees it. The shell spec (005) sets it at startup together with `CORE_BASE_URL`.
 */
export const CORE_SESSION_TOKEN = new InjectionToken<string | null>(
  'CORE_SESSION_TOKEN',
  {
    providedIn: 'root',
    factory: () => null,
  },
);
