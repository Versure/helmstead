import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { components, paths } from './index';

// The compiler checks these shapes: when the core's contract changes and the types are regenerated,
// this file stops compiling until it is updated.
type Health = components['schemas']['HealthResponse'];
type HealthResponseBody =
  paths['/health']['get']['responses']['200']['content']['application/json'];

describe('api contract', () => {
  it('exports the generated types from the public entry point', () => {
    const health: Health = { status: 'ok', version: '1.0.0' };
    const body: HealthResponseBody = health;

    expect(body.status).toBe('ok');
  });

  it('matches the OpenAPI document the core produced', () => {
    const document = JSON.parse(
      readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
    );

    expect(Object.keys(document.paths)).toContain('/health');
    expect(document.components.schemas.HealthResponse.required).toEqual([
      'status',
      'version',
    ]);
  });

  it('requires the session token on every operation and documents its 401 (spec 004)', () => {
    const document = JSON.parse(
      readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
    );

    expect(document.components.securitySchemes).toEqual({
      SessionToken: expect.objectContaining({ type: 'http', scheme: 'bearer' }),
    });
    const methods = [
      'get',
      'put',
      'post',
      'delete',
      'options',
      'head',
      'patch',
      'trace',
    ];
    const operations = Object.values(
      document.paths as Record<string, Record<string, unknown>>,
    ).flatMap((path) =>
      Object.entries(path)
        .filter(([method]) => methods.includes(method))
        .map(([, operation]) => operation as Operation),
    );
    expect(operations.length).toBeGreaterThan(0);
    for (const operation of operations) {
      expect(operation.security).toContainEqual({ SessionToken: [] });
      expect(
        operation.responses['401']?.content?.['application/problem+json'],
      ).toBeDefined();
    }
  });
});

interface Operation {
  security?: Record<string, string[]>[];
  responses: Record<string, { content?: Record<string, unknown> }>;
}
