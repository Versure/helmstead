import type { components } from '@helmstead/api-contracts';

/**
 * `GET /health` as the core answered it, recorded on 2026-10-29 from `dotnet run` (launch profile `http`,
 * http://127.0.0.1:5108). Typed with the contract, so a contract change that breaks it fails the build of the tests.
 */
export const recordedHealth: components['schemas']['HealthResponse'] = {
  status: 'ok',
  version: '1.0.0+67c771ad2f5b8dccc8cfee78acf1900ef1587505',
};
