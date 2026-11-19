// Dev server proxy to the core (spec 004 criterion 18). On every request it reads the token that `npx nx serve core`
// (tools/dev/serve-core.mjs) wrote, sets `Authorization: Bearer <token>`, sets `Host` to the core's address and removes
// `Origin`, so the core's checks pass and the browser never receives the token. Without the file it answers 502 itself
// and says once that the core must be running. Development only: the production build contains nothing of this file.
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Where the dev core listens. The proxy forwards to this address and nowhere else. */
export const CORE_ORIGIN = 'http://127.0.0.1:5108';

/** The file tools/dev/serve-core.mjs writes (the same path; tools/dev/dev-session.spec.ts checks both). */
export const TOKEN_FILE = path.resolve(
  import.meta.dirname,
  '../../.helmstead/dev-session-token',
);

const CORE_HOST = new URL(CORE_ORIGIN).host;

function readToken(file) {
  try {
    return readFileSync(file, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * One proxy entry for the Angular dev server (Vite). `bypass` runs before every proxied request; it rewrites the
 * request's headers in place, or ends the response with 502.
 */
export function coreProxy({
  tokenFile = TOKEN_FILE,
  warn = console.warn,
} = {}) {
  let warned = false;
  return {
    target: CORE_ORIGIN,
    secure: false,
    changeOrigin: false,
    ws: false,
    bypass(req, res) {
      // The core refuses every Origin, which this proxy removes; so it first refuses cross-site requests itself, or any
      // page open in the browser could send requests to the dev core with the token (CSRF).
      if (isCrossSite(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Cross-site requests are not forwarded to the core.');
        return req.url;
      }

      const token = readToken(tokenFile);
      if (!token) {
        if (!warned) {
          warned = true;
          warn(
            `The core is not running, or was not started by Nx: ${tokenFile} is missing. Run \`npx nx serve core\`.`,
          );
        }
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('The core is not running. Start it with `npx nx serve core`.');
        // A string makes Vite skip the proxy; the response has already ended, so nothing else is sent.
        return req.url;
      }

      warned = false;
      req.headers.authorization = `Bearer ${token}`;
      req.headers.host = CORE_HOST;
      delete req.headers.origin;
      return undefined;
    },
  };
}

/**
 * True when the browser says the request comes from another site: an `Origin` other than the dev server's own, or a
 * `Sec-Fetch-Site` other than `same-origin` or `none` (typed in the address bar).
 */
export function isCrossSite(req) {
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${req.headers.host}`)
    return true;
  const site = req.headers['sec-fetch-site'];
  return site !== undefined && site !== 'same-origin' && site !== 'none';
}

export default {
  '/health': coreProxy(),
};
