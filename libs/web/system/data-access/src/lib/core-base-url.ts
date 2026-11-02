import { InjectionToken } from '@angular/core';

/**
 * Where the core service listens, without a trailing slash. Empty by default, so requests go to the page's own
 * origin, where the dev server's proxy (apps/web/proxy.conf.json) forwards them to the core. The sidecar spec sets it
 * at startup to the core's random port.
 */
export const CORE_BASE_URL = new InjectionToken<string>('CORE_BASE_URL', {
  providedIn: 'root',
  factory: () => '',
});
