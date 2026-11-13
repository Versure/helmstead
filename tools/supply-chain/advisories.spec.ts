import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkAdvisories,
  expiredExceptions,
  formatAdvisoryReport,
  parseDotnetList,
  parseNpmAudit,
} from './advisories.mjs';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      path.join(import.meta.dirname, 'fixtures/advisories', name),
      'utf8',
    ),
  );

const today = '2026-11-13';
const policy = (vulnerabilityExceptions: object[] = []) => ({
  licenses: { shipped: ['MIT'], tooling: [] },
  licenseExceptions: [],
  vulnerabilityExceptions,
});
const exception = (fields: object) => ({
  ecosystem: 'npm',
  package: 'undici',
  advisory: 'GHSA-2m5v-pch6-74hx',
  reason: 'Only used by the nx CLI against the local daemon.',
  expires: '2026-12-31',
  ...fields,
});

const npmAdvisories = () => parseNpmAudit(fixture('npm-audit.json'));
const dotnetAdvisories = () => parseDotnetList(fixture('dotnet-list.json'));
const ids = (findings: { advisory: string }[]) =>
  findings.map((f) => f.advisory).sort();

describe('reading the audit output', () => {
  it('reads every advisory of npm audit, with its severity', () => {
    expect(
      npmAdvisories().map((a) => `${a.package} ${a.advisory} ${a.severity}`),
    ).toEqual([
      'undici GHSA-2jfj-6hjv-fm6j moderate',
      'undici GHSA-2gqq-gqf2-x968 low',
      'undici GHSA-xjj6-f33q-929c high',
      'undici GHSA-2m5v-pch6-74hx high',
      'minimatch GHSA-g3hv-75wg-m249 moderate',
    ]);
  });

  it('reads top-level and transitive packages of dotnet list, once per package and advisory', () => {
    expect(
      dotnetAdvisories().map(
        (a) => `${a.package}@${a.version} ${a.advisory} ${a.severity}`,
      ),
    ).toEqual([
      'Fixture.Critical@1.0.0 GHSA-crit-0000-0001 critical',
      'Fixture.Transitive@4.1.0 GHSA-high-0000-0002 high',
      'Fixture.Transitive@4.1.0 GHSA-mode-0000-0003 moderate',
    ]);
  });

  it('reads clean output as no advisories', () => {
    expect(parseNpmAudit(fixture('npm-audit-clean.json'))).toEqual([]);
    expect(parseDotnetList(fixture('dotnet-list-clean.json'))).toEqual([]);
  });

  it('fails when npm audit could not run, instead of reading it as clean', () => {
    expect(() => parseNpmAudit(fixture('npm-audit-error.json'))).toThrow(
      /npm audit failed: ENOTFOUND/,
    );
    expect(() => parseNpmAudit({})).toThrow(/not npm audit --json output/);
    expect(() => parseDotnetList({ version: 1 })).toThrow(
      /not dotnet list package --format json output/,
    );
  });

  it('fails when dotnet list reports an error problem', () => {
    expect(() =>
      parseDotnetList({
        version: 1,
        problems: [
          { level: 'error', text: 'Unable to load the service index' },
        ],
        projects: [],
      }),
    ).toThrow(/Unable to load the service index/);
  });
});

describe('checkAdvisories', () => {
  it('fails on high and critical advisories', () => {
    expect(ids(checkAdvisories(npmAdvisories(), policy(), today))).toEqual([
      'GHSA-2m5v-pch6-74hx',
      'GHSA-xjj6-f33q-929c',
    ]);
    expect(ids(checkAdvisories(dotnetAdvisories(), policy(), today))).toEqual([
      'GHSA-crit-0000-0001',
      'GHSA-high-0000-0002',
    ]);
  });

  it('lets moderate and low advisories pass', () => {
    const failing = ids(checkAdvisories(npmAdvisories(), policy(), today));

    expect(failing).not.toContain('GHSA-2jfj-6hjv-fm6j');
    expect(failing).not.toContain('GHSA-2gqq-gqf2-x968');
    expect(failing).not.toContain('GHSA-g3hv-75wg-m249');
  });

  it('lets an excepted high advisory pass', () => {
    expect(
      ids(checkAdvisories(npmAdvisories(), policy([exception({})]), today)),
    ).toEqual(['GHSA-xjj6-f33q-929c']);
  });

  it('matches NuGet exceptions on the package ID regardless of case', () => {
    const nuget = exception({
      ecosystem: 'nuget',
      package: 'fixture.transitive',
      advisory: 'GHSA-high-0000-0002',
    });

    expect(
      ids(checkAdvisories(dotnetAdvisories(), policy([nuget]), today)),
    ).toEqual(['GHSA-crit-0000-0001']);
  });

  it('does not apply an exception for a different advisory on the same package', () => {
    const other = exception({ advisory: 'GHSA-2jfj-6hjv-fm6j' });

    expect(
      ids(checkAdvisories(npmAdvisories(), policy([other]), today)),
    ).toEqual(['GHSA-2m5v-pch6-74hx', 'GHSA-xjj6-f33q-929c']);
  });

  it('does not apply an exception for another ecosystem', () => {
    const wrongEcosystem = exception({ ecosystem: 'nuget' });

    expect(
      ids(checkAdvisories(npmAdvisories(), policy([wrongEcosystem]), today)),
    ).toContain('GHSA-2m5v-pch6-74hx');
  });

  it('fails an advisory whose exception has expired', () => {
    const expired = exception({ expires: '2026-11-12' });

    expect(
      ids(checkAdvisories(npmAdvisories(), policy([expired]), today)),
    ).toContain('GHSA-2m5v-pch6-74hx');
  });

  it('still honours an exception on its expiry day', () => {
    const lastDay = exception({ expires: today });

    expect(
      ids(checkAdvisories(npmAdvisories(), policy([lastDay]), today)),
    ).not.toContain('GHSA-2m5v-pch6-74hx');
  });
});

describe('expired exceptions (criterion 8)', () => {
  it('reports an expired exception even when its advisory no longer exists', () => {
    const stale = exception({
      advisory: 'GHSA-gone-0000-0000',
      expires: '2026-01-31',
    });

    expect(expiredExceptions(policy([stale]), today)).toEqual([stale]);
    expect(formatAdvisoryReport({ failing: [], expired: [stale] }))
      .toMatchInlineSnapshot(`
      "Exception for npm package undici, advisory GHSA-gone-0000-0000, expired on 2026-01-31.
        Remove it from dependency-policy.json, or renew it with a new date and reason if the advisory still applies."
    `);
  });

  it('reports nothing when every exception is current', () => {
    expect(expiredExceptions(policy([exception({})]), today)).toEqual([]);
  });
});

describe('formatAdvisoryReport', () => {
  it('names the package, version, advisory and how to except it', () => {
    const failing = checkAdvisories(dotnetAdvisories(), policy(), today);

    expect(formatAdvisoryReport({ failing, expired: [] }))
      .toMatchInlineSnapshot(`
      "nuget package Fixture.Critical@1.0.0: critical advisory GHSA-crit-0000-0001
        https://github.com/advisories/GHSA-crit-0000-0001
        In: Helmstead.Core.Api.csproj
        Upgrade it. If it cannot be fixed yet, add this to "vulnerabilityExceptions" in dependency-policy.json (a high-risk change the owner reviews):
          {"ecosystem":"nuget","package":"Fixture.Critical","advisory":"GHSA-crit-0000-0001","reason":"<why it is not exploitable here>","expires":"<YYYY-MM-DD>"}
      nuget package Fixture.Transitive@4.1.0: high advisory GHSA-high-0000-0002
        https://github.com/advisories/GHSA-high-0000-0002
        In: Helmstead.Core.Api.csproj, Helmstead.Core.Tests.csproj
        Upgrade it. If it cannot be fixed yet, add this to "vulnerabilityExceptions" in dependency-policy.json (a high-risk change the owner reviews):
          {"ecosystem":"nuget","package":"Fixture.Transitive","advisory":"GHSA-high-0000-0002","reason":"<why it is not exploitable here>","expires":"<YYYY-MM-DD>"}"
    `);
  });
});
