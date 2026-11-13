import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkLicenses,
  collectNpm,
  collectNuget,
  formatLicenseFailure,
  isTestProject,
  type PackageRecord,
} from './licenses.mjs';
import { satisfiesRange } from './semver.mjs';
import { parseSpdx, spdxAllowed } from './spdx.mjs';

const fixtures = path.join(import.meta.dirname, 'fixtures');
const lock = JSON.parse(
  readFileSync(path.join(fixtures, 'npm/package-lock.json'), 'utf8'),
);

const policy = {
  licenses: {
    shipped: ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC'],
    tooling: ['MPL-2.0', 'CC0-1.0'],
  },
  licenseExceptions: [
    {
      ecosystem: 'npm' as const,
      package: 'excepted',
      versionRange: '1.0.0',
      reason: 'MIT licence file in the package; not declared in package.json.',
    },
    {
      ecosystem: 'npm' as const,
      package: 'excepted-other-version',
      versionRange: '>=1.0.0 <2.0.0',
      reason: 'Only the 1.x line was checked.',
    },
  ],
  vulnerabilityExceptions: [],
};

const npmFailures = () =>
  checkLicenses(collectNpm(lock), policy).map(
    (failure) => `${failure.name}@${failure.version}`,
  );

describe('SPDX expressions', () => {
  const allowed = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'CC0-1.0'];

  it.each([
    ['MIT', true],
    ['mit', true],
    ['(MIT OR CC0-1.0)', true],
    ['(WTFPL OR MIT)', true],
    ['(Apache-2.0 AND BSD-3-Clause)', true],
    ['(MIT AND GPL-3.0)', false],
    ['MIT AND (GPL-3.0 OR BSD-3-Clause)', true],
    ['GPL-3.0 OR (MIT AND LGPL-2.1)', false],
    ['GPL-2.0+', false],
    ['GPL-2.0 WITH Classpath-exception-2.0', false],
    ['UNLICENSED', false],
  ])('%s allowed: %s', (expression, expected) => {
    expect(spdxAllowed(parseSpdx(expression), allowed)).toBe(expected);
  });

  it.each(['', 'SEE LICENSE IN LICENSE.txt', 'MIT OR', '(MIT', 'MIT)'])(
    'does not parse %j',
    (expression) => {
      expect(parseSpdx(expression)).toBeUndefined();
    },
  );
});

describe('version ranges of exceptions', () => {
  it.each([
    ['1.0.0', '1.0.0', true],
    ['1.0.1', '1.0.0', false],
    ['2.3.4', '*', true],
    ['1.5.0', '>=1.0.0 <2.0.0', true],
    ['2.0.0', '>=1.0.0 <2.0.0', false],
    ['1.0.0-beta.1', '>=1.0.0', false],
    ['10.0.14', '>=9.0.0 <=10.0.14', true],
  ])('%s satisfies %s: %s', (version, range, expected) => {
    expect(satisfiesRange(version, range)).toBe(expected);
  });
});

describe('npm licences', () => {
  it('skips the root package and classifies dev packages as tooling', () => {
    const records = collectNpm(lock);
    const tier = (name: string) => records.find((r) => r.name === name)?.tier;

    expect(records.some((r) => r.name === 'fixture-root')).toBe(false);
    expect(tier('app-lib')).toBe('shipped');
    expect(tier('build-tool')).toBe('tooling');
  });

  it.each([
    ['a shipped MPL package fails', 'shipped-mpl@2.0.0', true],
    ['a tooling MPL package passes', 'tooling-mpl@1.0.0', false],
    ['(MIT OR CC0-1.0) passes', 'either@1.0.0', false],
    ['(Apache-2.0 AND BSD-3-Clause) passes', 'both@1.0.0', false],
    ['(MIT AND GPL-3.0) fails', 'copyleft-mix@1.0.0', true],
    ['a missing licence fails', 'no-licence@1.0.0', true],
    ['a non-SPDX licence fails', 'not-spdx@1.0.0', true],
    ['UNLICENSED fails', 'unlicensed@1.0.0', true],
    ['an exception passes', 'excepted@1.0.0', false],
    [
      'an exception for another version range does not apply',
      'excepted-other-version@2.0.0',
      true,
    ],
    ['a nested copy is checked on its own', 'either@0.9.0', true],
  ])('%s', (_, pkg, fails) => {
    expect(npmFailures().includes(pkg)).toBe(fails);
  });

  it('finds the dependency path through nested node_modules', () => {
    const records = collectNpm(lock);

    expect(
      records.find((r) => r.name === 'either' && r.version === '0.9.0')?.path,
    ).toEqual(['fixture-root', 'build-tool', 'either']);
    expect(records.find((r) => r.name === 'copyleft-mix')?.path).toEqual([
      'fixture-root',
      'app-lib',
      'copyleft-mix',
    ]);
  });

  it('says what failed, where it came from and how to add an exception', () => {
    const [failure] = checkLicenses(collectNpm(lock), policy).filter(
      (f) => f.name === 'no-licence',
    );

    expect(formatLicenseFailure(failure, policy)).toMatchInlineSnapshot(`
      "npm package no-licence@1.0.0 (tooling): licence none declared is not allowed.
        Pulled in by: fixture-root > build-tool > no-licence
        Allowed for tooling: MIT, Apache-2.0, BSD-3-Clause, ISC, MPL-2.0, CC0-1.0
        If it is acceptable, add this to "licenseExceptions" in dependency-policy.json. That is a high-risk change the owner reviews:
          {"ecosystem":"npm","package":"no-licence","versionRange":"1.0.0","reason":"<why this licence is acceptable, and where you checked it>"}"
    `);
  });
});

describe('NuGet licences', () => {
  const records = () =>
    collectNuget(
      [
        path.join(fixtures, 'nuget/Api/project.assets.json'),
        path.join(fixtures, 'nuget/Tests/project.assets.json'),
      ],
      [path.join(fixtures, 'nuget/packages')],
    );
  const find = (name: string) =>
    records().find((r) => r.name === name) as PackageRecord;

  it('treats packages reached only from test projects as tooling', () => {
    expect(find('Shipped.Lib').tier).toBe('shipped');
    expect(find('Transitive.Lib').tier).toBe('shipped');
    expect(find('Test.Framework').tier).toBe('tooling');
    expect(find('Test.Helper').tier).toBe('tooling');
  });

  it('reads the SPDX expression from the nuspec, and treats licenseUrl and type="file" as none', () => {
    expect(find('Shipped.Lib').license).toBe('MIT');
    expect(find('Test.Helper').license).toBe('MPL-2.0');
    expect(find('Transitive.Lib').license).toBeUndefined();
    expect(find('File.Licensed').license).toBeUndefined();
  });

  it('fails the packages without an SPDX licence and passes the rest', () => {
    expect(
      checkLicenses(records(), policy).map((f) => `${f.name}@${f.version}`),
    ).toEqual(['Transitive.Lib@2.0.0', 'File.Licensed@1.0.0']);
  });

  it('gives the dependency path from the project', () => {
    expect(find('Transitive.Lib').path).toEqual([
      'Helmstead.Core.Api',
      'Shipped.Lib',
      'Transitive.Lib',
    ]);
    expect(find('File.Licensed').path).toEqual([
      'Helmstead.Core.Tests',
      'Test.Framework',
      'File.Licensed',
    ]);
  });

  it('says what failed, where it came from and how to add an exception', () => {
    const failure = checkLicenses(records(), policy).find(
      (f) => f.name === 'Transitive.Lib',
    ) as PackageRecord;

    expect(formatLicenseFailure(failure, policy)).toMatchInlineSnapshot(`
      "nuget package Transitive.Lib@2.0.0 (shipped): licence none declared is not allowed.
        Pulled in by: Helmstead.Core.Api > Shipped.Lib > Transitive.Lib
        Allowed for shipped: MIT, Apache-2.0, BSD-3-Clause, ISC
        If it is acceptable, add this to "licenseExceptions" in dependency-policy.json. That is a high-risk change the owner reviews:
          {"ecosystem":"nuget","package":"Transitive.Lib","versionRange":"2.0.0","reason":"<why this licence is acceptable, and where you checked it>"}"
    `);
  });

  it.each([
    ['Helmstead.Core.Tests', 'apps/core/tests/Helmstead.Core.Tests', true],
    [
      'Helmstead.Web.Fixture',
      'apps/core/tests/fixtures/Helmstead.Web.Fixture',
      true,
    ],
    ['Helmstead.Core.Api', 'apps/core/src/Helmstead.Core.Api', false],
  ])('%s is a test project: %s', (name, dir, expected) => {
    expect(isTestProject(name, `/repo/${dir}/${name}.csproj`)).toBe(expected);
  });
});
