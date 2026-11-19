import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { EnvironmentProviders } from '@angular/core';
import { coreSessionInterceptor } from './core-session.interceptor';

/**
 * The HTTP client for calls to the core, for the app config. HTTP stays inside data-access libs (ADR-004), so the app
 * gets it from here instead of importing @angular/common/http. It sends the session token to the core (spec 004).
 */
export function provideCoreHttp(): EnvironmentProviders {
  return provideHttpClient(
    withFetch(),
    withInterceptors([coreSessionInterceptor]),
  );
}
