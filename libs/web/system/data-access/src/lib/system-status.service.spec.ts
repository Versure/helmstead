import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CORE_BASE_URL } from './core-base-url';
import { recordedHealth } from './health.fixture';
import { SystemStatusService } from './system-status.service';

describe('SystemStatusService', () => {
  let http: HttpTestingController;

  const setup = (baseUrl?: string) => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ...(baseUrl === undefined
          ? []
          : [{ provide: CORE_BASE_URL, useValue: baseUrl }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const service = TestBed.inject(SystemStatusService);
    TestBed.tick();
    return service;
  };

  afterEach(() => http.verify());

  it('is connecting while GET /health is pending', () => {
    const service = setup();

    const request = http.expectOne('/health');
    expect(request.request.method).toBe('GET');
    expect(service.status()).toEqual({ state: 'connecting' });
    request.flush(recordedHealth);
  });

  it('gives up after 5 seconds', () => {
    setup();

    expect(http.expectOne('/health').request.timeout).toBe(5000);
  });

  it('is connected with the version on 200', async () => {
    const service = setup();

    http.expectOne('/health').flush(recordedHealth);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(service.status()).toEqual({
      state: 'connected',
      version: recordedHealth.version,
    });
  });

  it.each([
    {
      what: 'a server error',
      fail: (r: ReturnType<HttpTestingController['expectOne']>) =>
        r.flush('boom', { status: 500, statusText: 'Internal Server Error' }),
    },
    {
      what: 'a refused connection',
      fail: (r: ReturnType<HttpTestingController['expectOne']>) =>
        r.error(new ProgressEvent('error'), { status: 0 }),
    },
    {
      what: 'a timeout',
      fail: (r: ReturnType<HttpTestingController['expectOne']>) =>
        r.error(new ProgressEvent('timeout'), { status: 0 }),
    },
  ])('is unreachable on $what', async ({ fail }) => {
    const service = setup();

    fail(http.expectOne('/health'));
    await TestBed.inject(ApplicationRef).whenStable();

    expect(service.status()).toEqual({ state: 'unreachable' });
  });

  it('re-issues the request on retry', async () => {
    const service = setup();
    http.expectOne('/health').error(new ProgressEvent('error'), { status: 0 });
    await TestBed.inject(ApplicationRef).whenStable();

    service.retry();
    TestBed.tick();

    const again = http.expectOne('/health');
    expect(service.status()).toEqual({ state: 'connecting' });
    again.flush(recordedHealth);
    await TestBed.inject(ApplicationRef).whenStable();
    expect(service.status().state).toBe('connected');
  });

  it('calls the core at CORE_BASE_URL when it is set', () => {
    setup('http://127.0.0.1:43123');

    http.expectOne('http://127.0.0.1:43123/health').flush(recordedHealth);
  });
});
