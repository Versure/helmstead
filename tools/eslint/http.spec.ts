import { describe, expect, it } from 'vitest';
import { errorsOf, lintFixture } from './lint-fixture';

// Spec 002 criterion 7: HTTP only in a type:data-access lib.
const OUTSIDE = [
  'apps/web/src/app/fixture.ts',
  'libs/web/system/feature/src/lib/fixture.ts',
  'libs/web/system/ui/src/lib/fixture.ts',
  'libs/web/system/model/src/lib/fixture.ts',
  'libs/ui/src/lib/fixture.ts',
];
const INSIDE = 'libs/web/system/data-access/src/lib/fixture.ts';

const CASES = [
  {
    what: 'an import from @angular/common/http',
    rule: 'no-restricted-imports',
    code: "import { HttpClient } from '@angular/common/http';\nexport const used = HttpClient;\n",
  },
  {
    what: 'an import from @angular/common/http/testing',
    rule: 'no-restricted-imports',
    code: "import { HttpTestingController } from '@angular/common/http/testing';\nexport const used = HttpTestingController;\n",
  },
  {
    what: 'fetch',
    rule: 'no-restricted-globals',
    code: "export const load = () => fetch('/health');\n",
  },
  {
    what: 'window.fetch',
    rule: 'no-restricted-properties',
    code: "export const load = () => window.fetch('/health');\n",
  },
  {
    what: 'XMLHttpRequest',
    rule: 'no-restricted-globals',
    code: 'export const request = new XMLHttpRequest();\n',
  },
  {
    what: 'WebSocket',
    rule: 'no-restricted-globals',
    code: "export const socket = new WebSocket('ws://127.0.0.1');\n",
  },
  {
    what: 'EventSource',
    rule: 'no-restricted-globals',
    code: "export const events = new EventSource('/events');\n",
  },
];

describe('HTTP outside a data-access lib', () => {
  it.each(OUTSIDE.flatMap((file) => CASES.map((c) => ({ ...c, file }))))(
    'fails lint for $what in $file',
    async ({ file, code, rule }) => {
      const messages = await lintFixture(file, code);

      expect(errorsOf(messages, rule)).toHaveLength(1);
    },
  );
});

describe('HTTP inside a data-access lib', () => {
  it.each(CASES)('passes lint for $what', async ({ code, rule }) => {
    const messages = await lintFixture(INSIDE, code);

    expect(errorsOf(messages, rule)).toEqual([]);
  });
});
