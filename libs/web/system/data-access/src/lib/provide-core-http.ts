import { provideHttpClient, withFetch } from '@angular/common/http';
import { EnvironmentProviders } from '@angular/core';

/**
 * The HTTP client for calls to the core, for the app config. HTTP stays inside data-access libs (ADR-004), so the app
 * gets it from here instead of importing @angular/common/http.
 */
export function provideCoreHttp(): EnvironmentProviders {
  return provideHttpClient(withFetch());
}
