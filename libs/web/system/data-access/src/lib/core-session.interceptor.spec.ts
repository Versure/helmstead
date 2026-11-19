import { HttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { components } from '@helmstead/api-contracts';
import { CORE_BASE_URL } from './core-base-url';
import { CORE_SESSION_TOKEN } from './core-session-token';
import { recordedHealth } from './health.fixture';
import { provideCoreHttp } from './provide-core-http';

// Spec 004 criterion 14: the session token goes to the core, and only to the core. The token is made up per run
// (ADR-005: never a literal token in a test).
describe('the core session interceptor', () => {
  const token = `test-${crypto.randomUUID()}`;
  let http: HttpTestingController;
  let client: HttpClient;

  const setup = (baseUrl?: string, sessionToken?: string | null) => {
    TestBed.configureTestingModule({
      providers: [
        provideCoreHttp(),
        provideHttpClientTesting(),
        ...(baseUrl === undefined
          ? []
          : [{ provide: CORE_BASE_URL, useValue: baseUrl }]),
        ...(sessionToken === undefined
          ? []
          : [{ provide: CORE_SESSION_TOKEN, useValue: sessionToken }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  };

  const authorizationOf = (url: string) => {
    client.get<components['schemas']['HealthResponse']>(url).subscribe();
    const request = http.expectOne(url);
    const header = request.request.headers.get('Authorization');
    request.flush(recordedHealth);
    return header;
  };

  afterEach(() => http.verify());

  it('is null by default', () => {
    setup();

    expect(TestBed.inject(CORE_SESSION_TOKEN)).toBeNull();
  });

  it('adds the bearer token to a request to the core', () => {
    setup('http://127.0.0.1:5108', token);

    expect(authorizationOf('http://127.0.0.1:5108/health')).toBe(
      `Bearer ${token}`,
    );
  });

  it.each([
    ['another origin', 'https://example.com/health'],
    ['another port that shares the prefix', 'http://127.0.0.1:51080/health'],
    ['a host that shares the prefix', 'http://127.0.0.1:5108.example.com/'],
    ['the base URL without a path', 'http://127.0.0.1:5108'],
    ['a relative URL', '/health'],
  ])('never adds it to %s', (_, url) => {
    setup('http://127.0.0.1:5108', token);

    expect(authorizationOf(url)).toBeNull();
  });

  it('adds nothing with the defaults (empty base URL, no token)', () => {
    setup();

    expect(authorizationOf('/health')).toBeNull();
  });

  it('adds nothing when the base URL is empty, even with a token', () => {
    setup('', token);

    expect(authorizationOf('/health')).toBeNull();
  });

  it('adds nothing when the token is null', () => {
    setup('http://127.0.0.1:5108', null);

    expect(authorizationOf('http://127.0.0.1:5108/health')).toBeNull();
  });
});
