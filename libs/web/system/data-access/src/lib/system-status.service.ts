import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { computed, inject, Injectable, Signal } from '@angular/core';
import type { components } from '@helmstead/api-contracts';
import type { SystemStatus } from '@helmstead/system-model';
import { CORE_BASE_URL } from './core-base-url';

type HealthResponse = components['schemas']['HealthResponse'];

/** Asks the core once whether it is up (`GET /health`), and again on retry. No polling (spec 002). */
@Injectable({ providedIn: 'root' })
export class SystemStatusService {
  private readonly baseUrl = inject(CORE_BASE_URL);
  private readonly health = httpResource<HealthResponse>(() => ({
    url: `${this.baseUrl}/health`,
    timeout: 5000,
  }));

  readonly status: Signal<SystemStatus> = computed(() => {
    if (this.health.isLoading()) return { state: 'connecting' };
    const error = this.health.error();
    // 401: the core is up but does not accept this session's token (spec 004). Anything else, 403 included, is
    // reported as unreachable.
    if (error instanceof HttpErrorResponse && error.status === 401)
      return { state: 'rejected' };
    if (error) return { state: 'unreachable' };
    const health = this.health.value();
    return health
      ? { state: 'connected', version: health.version }
      : { state: 'connecting' };
  });

  retry(): void {
    this.health.reload();
  }
}
