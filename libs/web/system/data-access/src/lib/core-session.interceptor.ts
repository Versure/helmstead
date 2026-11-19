import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CORE_BASE_URL } from './core-base-url';
import { CORE_SESSION_TOKEN } from './core-session-token';

/**
 * Adds `Authorization: Bearer <token>` to requests to the core, and to nothing else (spec 004 criterion 14). A request
 * counts as one to the core only when a token is set, `CORE_BASE_URL` is not empty, and the URL starts with the base
 * URL followed by `/`. So a relative URL, another origin, or a port or host that only shares the prefix
 * (`…:51080` against `…:5108`) never gets the token.
 */
export const coreSessionInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(CORE_SESSION_TOKEN);
  const baseUrl = inject(CORE_BASE_URL);

  if (!token || !baseUrl || !request.url.startsWith(`${baseUrl}/`)) {
    return next(request);
  }

  return next(
    request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }),
  );
};
