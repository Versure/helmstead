import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';
import { repoRoot } from '../lint-fixture';
import { contractTypes } from './contract-types.mjs';

// Spec 002 criterion 8. The rule needs type information, so the cases are type-checked as one file next to this
// test (it does not exist on disk; the project service gives it the workspace's path aliases).
RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const filename = `${repoRoot}/tools/eslint/rules/fixture.ts`;
const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      projectService: {
        allowDefaultProject: ['tools/eslint/rules/fixture.ts'],
        defaultProject: 'tsconfig.base.json',
      },
      tsconfigRootDir: repoRoot,
    },
  },
});

const header = `import { HttpClient, httpResource } from '@angular/common/http';
import { inject } from '@angular/core';
import type { components } from '@helmstead/api-contracts';

type HealthResponse = components['schemas']['HealthResponse'];
interface LocalHealth { status: string; version: string }
type AliasOfLocal = LocalHealth;
interface ExtendsContract extends HealthResponse { extra: string }
const http = inject(HttpClient);
`;
const code = (body: string) => `${header}${body}\n`;

tester.run('contract-types', contractTypes, {
  valid: [
    {
      name: 'HttpClient.get with a contract type',
      filename,
      code: code("export const health$ = http.get<HealthResponse>('/health');"),
    },
    {
      name: 'HttpClient.get with the contract type written in full',
      filename,
      code: code(
        "export const health$ = http.get<components['schemas']['HealthResponse']>('/health');",
      ),
    },
    {
      name: 'an array of a contract type',
      filename,
      code: code("export const all$ = http.get<HealthResponse[]>('/health');"),
    },
    {
      name: 'httpResource with a contract type',
      filename,
      code: code(
        "export const health = httpResource<HealthResponse>(() => '/health');",
      ),
    },
    {
      name: 'a get on something that is not HttpClient',
      filename,
      code: code(
        "const map = new Map<string, LocalHealth>();\nexport const got = map.get('a');",
      ),
    },
  ],
  invalid: [
    {
      name: 'HttpClient.get with a local interface',
      filename,
      code: code("export const health$ = http.get<LocalHealth>('/health');"),
      errors: [{ messageId: 'notContract' }],
    },
    {
      name: 'HttpClient.get with a type alias of a local interface',
      filename,
      code: code("export const health$ = http.get<AliasOfLocal>('/health');"),
      errors: [{ messageId: 'notContract' }],
    },
    {
      name: 'HttpClient.get with a local interface that extends a contract type',
      filename,
      code: code(
        "export const health$ = http.get<ExtendsContract>('/health');",
      ),
      errors: [{ messageId: 'notContract' }],
    },
    {
      name: 'HttpClient.get with an intersection that adds a local type',
      filename,
      code: code(
        "export const health$ = http.get<HealthResponse & { extra: string }>('/health');",
      ),
      errors: [{ messageId: 'notContract' }],
    },
    {
      name: 'HttpClient.post with an inline object type',
      filename,
      code: code(
        "export const created$ = http.post<{ id: string }>('/things', {});",
      ),
      errors: [{ messageId: 'notContract' }],
    },
    {
      name: 'HttpClient.get with any',
      filename,
      code: code("export const health$ = http.get<any>('/health');"),
      errors: [{ messageId: 'anyOrUnknown' }],
    },
    {
      name: 'HttpClient.get with unknown',
      filename,
      code: code("export const health$ = http.get<unknown>('/health');"),
      errors: [{ messageId: 'anyOrUnknown' }],
    },
    {
      name: 'HttpClient.get without a type argument',
      filename,
      code: code("export const health$ = http.get('/health');"),
      errors: [{ messageId: 'missing' }],
    },
    {
      name: 'httpResource with a local interface',
      filename,
      code: code(
        "export const health = httpResource<LocalHealth>(() => '/health');",
      ),
      errors: [{ messageId: 'notContract' }],
    },
    {
      name: 'httpResource with any',
      filename,
      code: code("export const health = httpResource<any>(() => '/health');"),
      errors: [{ messageId: 'anyOrUnknown' }],
    },
    {
      name: 'httpResource with unknown',
      filename,
      code: code(
        "export const health = httpResource<unknown>(() => '/health');",
      ),
      errors: [{ messageId: 'anyOrUnknown' }],
    },
    {
      name: 'httpResource through a variable alias, with a local interface',
      filename,
      code: code(
        "const resource = httpResource;\nexport const health = resource<LocalHealth>(() => '/health');",
      ),
      errors: [{ messageId: 'notContract' }],
    },
    {
      name: 'a subclass of HttpClient, with a local interface',
      filename,
      code: code(
        "class CoreHttp extends HttpClient {}\nexport const health$ = inject(CoreHttp).get<LocalHealth>('/health');",
      ),
      errors: [{ messageId: 'notContract' }],
    },
    {
      name: 'a contract-like generic alias instantiated with a local type',
      filename,
      code: code(
        "type Envelope<T> = { data: T };\nexport const health$ = http.get<Envelope<LocalHealth>>('/health');",
      ),
      errors: [{ messageId: 'notContract' }],
    },
    {
      name: 'httpResource without a type argument',
      filename,
      code: code("export const health = httpResource(() => '/health');"),
      errors: [{ messageId: 'missing' }],
    },
  ],
});
