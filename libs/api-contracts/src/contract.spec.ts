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
});
