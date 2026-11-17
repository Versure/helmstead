import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPolicy, POLICY_PATH, validatePolicy } from './policy.mjs';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      path.join(import.meta.dirname, 'fixtures/policy', `${name}.json`),
      'utf8',
    ),
  );

describe('validatePolicy', () => {
  it('accepts a complete policy', () => {
    expect(validatePolicy(fixture('valid'))).toEqual([]);
  });

  it.each([
    [
      'license-exception-without-reason',
      '/licenseExceptions/0: is missing "reason"',
    ],
    [
      'license-exception-with-blank-reason',
      '/licenseExceptions/0/reason: must match pattern \\S',
    ],
    [
      'vulnerability-exception-without-expiry',
      '/vulnerabilityExceptions/0: is missing "expires"',
    ],
    [
      'vulnerability-exception-without-reason',
      '/vulnerabilityExceptions/0: is missing "reason"',
    ],
    [
      'vulnerability-exception-with-bad-date',
      '/vulnerabilityExceptions/0/expires: must match pattern',
    ],
    [
      'unknown-ecosystem',
      '/licenseExceptions/0/ecosystem: must be one of "npm", "nuget"',
    ],
    ['missing-tooling', '/licenses: is missing "tooling"'],
  ])('rejects %s', (name, error) => {
    const errors = validatePolicy(fixture(name));

    expect(errors.some((e) => e.startsWith(error))).toBe(true);
  });

  it('rejects an expiry that is not a real date', () => {
    const policy = fixture('valid') as {
      vulnerabilityExceptions: { expires: string }[];
    };
    policy.vulnerabilityExceptions[0].expires = '2030-02-31';

    expect(validatePolicy(policy)).toEqual([
      '/vulnerabilityExceptions/0/expires: 2030-02-31 is not a calendar date',
    ]);
  });

  it('rejects unknown keys, so a typo cannot hide an exception', () => {
    const policy = fixture('valid') as Record<string, unknown>;
    policy['licenceExceptions'] = [];

    expect(validatePolicy(policy)).toEqual([
      '/: has unknown property "licenceExceptions"',
    ]);
  });
});

describe('the repository policy', () => {
  it('is valid', () => {
    expect(() => loadPolicy()).not.toThrow();
    expect(
      validatePolicy(JSON.parse(readFileSync(POLICY_PATH, 'utf8'))),
    ).toEqual([]);
  });

  it('holds the licence tiers of spec 003', () => {
    const policy = loadPolicy();

    expect(policy.licenses.shipped).toEqual([
      'MIT',
      'Apache-2.0',
      'BSD-2-Clause',
      'BSD-3-Clause',
      'ISC',
      '0BSD',
      'Unlicense',
    ]);
    expect(policy.licenses.tooling).toEqual([
      'MPL-2.0',
      'BlueOak-1.0.0',
      'MIT-0',
      'CC0-1.0',
      'CC-BY-4.0',
      'Python-2.0',
    ]);
  });
});
