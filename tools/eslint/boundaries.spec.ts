import { describe, expect, it } from 'vitest';
import { ESLint, type Linter } from 'eslint';
import { errorsOf, lintFixture, repoRoot } from './lint-fixture';

const BOUNDARIES = '@nx/enforce-module-boundaries';
const NO_DISABLE = '@eslint-community/eslint-comments/no-restricted-disable';

describe('forbidden edges between projects', () => {
  it.each([
    {
      edge: 'an app importing another app',
      file: 'apps/web/src/fixture.ts',
      code: "import { x } from '../../core/src/fixture';\nconsole.log(x);\n",
    },
    {
      edge: 'scope:web importing a scope:core project',
      file: 'libs/ui/src/fixture.ts',
      code: "import { x } from '../../../apps/core/src/fixture';\nconsole.log(x);\n",
    },
    {
      edge: 'scope:shared importing a scope:web project',
      file: 'libs/api-contracts/src/fixture.ts',
      code: "import { Ui } from '@helmstead/ui';\nconsole.log(Ui);\n",
    },
  ])('reports one boundary error for $edge', async ({ file, code }) => {
    const messages = await lintFixture(file, code);

    expect(errorsOf(messages, BOUNDARIES)).toHaveLength(1);
  });
});

describe('allowed edges between projects', () => {
  it.each([
    {
      edge: 'scope:web (data-access) importing scope:shared (contracts)',
      file: 'libs/web/system/data-access/src/lib/fixture.ts',
      code: "import type { components } from '@helmstead/api-contracts';\nexport type T = components;\n",
    },
    {
      edge: 'scope:web (app) importing a scope:web lib',
      file: 'apps/web/src/fixture.ts',
      code: "import { Ui } from '@helmstead/ui';\nconsole.log(Ui);\n",
    },
  ])('reports no boundary error for $edge', async ({ file, code }) => {
    const messages = await lintFixture(file, code);

    expect(errorsOf(messages, BOUNDARIES)).toHaveLength(0);
  });
});

// The frontend's domain and layer edges (spec 002 criterion 2, docs/adr/004-frontend-architecture.md). Each source is
// a file in a project of that type; each target is the project behind the alias. Projects named lint-fixture-* live in
// tools/eslint/fixtures/projects and stand in for types and domains the workspace does not have yet.
const SOURCE = {
  app: 'apps/web/src/app/fixture.ts',
  appConfig: 'apps/web/src/app/app.config.ts',
  feature: 'libs/web/system/feature/src/lib/fixture.ts',
  dataAccess: 'libs/web/system/data-access/src/lib/fixture.ts',
  ui: 'libs/web/system/ui/src/lib/fixture.ts',
  model: 'libs/web/system/model/src/lib/fixture.ts',
  util: 'tools/eslint/fixtures/projects/system-util/src/fixture.ts',
  api: 'libs/web/system/api/src/fixture.ts',
  sharedUi: 'libs/ui/src/lib/fixture.ts',
};

const TARGET = {
  feature: '@helmstead/system-feature',
  otherFeatureSameDomain: '@helmstead/lint-fixture-system-feature',
  ui: '@helmstead/system-ui',
  dataAccess: '@helmstead/system-data-access',
  model: '@helmstead/system-model',
  util: '@helmstead/lint-fixture-system-util',
  api: '@helmstead/system-api',
  contracts: '@helmstead/api-contracts',
  sharedUi: '@helmstead/ui',
  sharedUtil: '@helmstead/lint-fixture-shared-util',
  otherDomainApi: '@helmstead/lint-fixture-other-api',
  otherDomainUi: '@helmstead/lint-fixture-other-ui',
};

const importOf = (target: string) =>
  `import * as target from '${target}';\nexport const used = target;\n`;

describe('allowed frontend edges', () => {
  it.each([
    ['type:app', 'type:feature', SOURCE.app, TARGET.feature],
    ['type:app', 'type:ui', SOURCE.app, TARGET.ui],
    ['type:app', 'type:ui (domain:shared)', SOURCE.app, TARGET.sharedUi],
    ['type:app', 'type:util', SOURCE.app, TARGET.util],
    ['type:app', 'type:model', SOURCE.app, TARGET.model],
    ['type:app', 'type:api', SOURCE.app, TARGET.api],
    [
      'type:app (app config)',
      'type:data-access',
      SOURCE.appConfig,
      TARGET.dataAccess,
    ],
    ['type:feature', 'type:ui', SOURCE.feature, TARGET.ui],
    ['type:feature', 'type:data-access', SOURCE.feature, TARGET.dataAccess],
    ['type:feature', 'type:model', SOURCE.feature, TARGET.model],
    ['type:feature', 'type:util', SOURCE.feature, TARGET.util],
    ['type:data-access', 'type:model', SOURCE.dataAccess, TARGET.model],
    ['type:data-access', 'type:util', SOURCE.dataAccess, TARGET.util],
    ['type:data-access', 'type:contracts', SOURCE.dataAccess, TARGET.contracts],
    ['type:ui', 'type:model', SOURCE.ui, TARGET.model],
    ['type:ui', 'type:util', SOURCE.ui, TARGET.util],
    ['type:model', 'type:util', SOURCE.model, TARGET.util],
    ['type:util', 'type:util', SOURCE.util, TARGET.sharedUtil],
    ['type:api', 'its own type:feature', SOURCE.api, TARGET.feature],
    ['type:api', 'its own type:ui', SOURCE.api, TARGET.ui],
    ['type:api', 'its own type:data-access', SOURCE.api, TARGET.dataAccess],
    ['type:api', 'its own type:model', SOURCE.api, TARGET.model],
    ['domain:system', 'domain:shared', SOURCE.ui, TARGET.sharedUtil],
    [
      'domain:system (feature)',
      "another domain's type:api",
      SOURCE.feature,
      TARGET.otherDomainApi,
    ],
    ['domain:shared', 'domain:shared', SOURCE.sharedUi, TARGET.sharedUtil],
  ])('%s → %s reports no boundary error', async (_from, _to, file, target) => {
    const messages = await lintFixture(file, importOf(target));

    expect(errorsOf(messages, BOUNDARIES)).toEqual([]);
  });
});

describe('forbidden frontend edges', () => {
  it.each([
    ['type:app', 'type:contracts', SOURCE.app, TARGET.contracts],
    [
      'type:feature',
      'type:feature',
      SOURCE.feature,
      TARGET.otherFeatureSameDomain,
    ],
    ['type:feature', 'type:contracts', SOURCE.feature, TARGET.contracts],
    ['type:data-access', 'type:feature', SOURCE.dataAccess, TARGET.feature],
    ['type:data-access', 'type:ui', SOURCE.dataAccess, TARGET.ui],
    ['type:ui', 'type:data-access', SOURCE.ui, TARGET.dataAccess],
    ['type:ui', 'type:feature', SOURCE.ui, TARGET.feature],
    ['type:ui', 'type:contracts', SOURCE.ui, TARGET.contracts],
    ['type:model', 'type:ui', SOURCE.model, TARGET.ui],
    ['type:model', 'type:data-access', SOURCE.model, TARGET.dataAccess],
    ['type:model', 'type:contracts', SOURCE.model, TARGET.contracts],
    ['type:util', 'type:model', SOURCE.util, TARGET.model],
    ['type:api', 'type:util', SOURCE.api, TARGET.util],
    [
      'type:api',
      "another domain's type:api",
      SOURCE.api,
      TARGET.otherDomainApi,
    ],
    ['type:api', "another domain's type:ui", SOURCE.api, TARGET.otherDomainUi],
    [
      'domain:system (feature)',
      "another domain's type:ui",
      SOURCE.feature,
      TARGET.otherDomainUi,
    ],
    ['domain:shared', 'domain:system', SOURCE.sharedUi, TARGET.model],
    ['domain:shared', 'a domain:system util', SOURCE.sharedUi, TARGET.util],
  ])(
    '%s → %s reports exactly one boundary error',
    async (_from, _to, file, target) => {
      const messages = await lintFixture(file, importOf(target));

      expect(errorsOf(messages, BOUNDARIES)).toHaveLength(1);
    },
  );
});

describe('switching the boundary rule off', () => {
  const forbiddenImport =
    "import { x } from '../../core/src/fixture';\nconsole.log(x);\n";

  it.each([
    {
      how: 'a disable-next-line comment',
      code: `// eslint-disable-next-line ${BOUNDARIES}\n${forbiddenImport}`,
    },
    {
      how: 'a disable-line comment',
      code: forbiddenImport.replace(
        ';\n',
        `; // eslint-disable-line ${BOUNDARIES}\n`,
      ),
    },
    {
      how: 'a file-level disable of that rule',
      code: `/* eslint-disable ${BOUNDARIES} */\n${forbiddenImport}`,
    },
    {
      how: 'a file-level disable of every rule',
      code: `/* eslint-disable */\n${forbiddenImport}`,
    },
    {
      how: 'an inline config comment that sets the rule to off',
      code: `/* eslint ${BOUNDARIES}: 'off' */\n${forbiddenImport}`,
    },
    {
      how: 'a file-level disable of the ban itself, then of the rule',
      code: `/* eslint-disable ${NO_DISABLE} */\n/* eslint-disable ${BOUNDARIES} */\n${forbiddenImport}`,
    },
    {
      how: 'an inline config comment that turns the ban off',
      code: `/* eslint ${NO_DISABLE}: 'off' */\n/* eslint-disable ${BOUNDARIES} */\n${forbiddenImport}`,
    },
    {
      how: 'a line-level disable of the ban, then of the rule',
      code: `// eslint-disable-next-line ${NO_DISABLE}\n/* eslint-disable ${BOUNDARIES} */\n${forbiddenImport}`,
    },
  ])('fails lint for $how', async ({ code }) => {
    const messages = await lintFixture('apps/web/src/fixture.ts', code);

    // Lint must fail, and it must fail on the comment itself or on the import it tried to hide.
    const problems = messages.filter(
      (m) =>
        m.ruleId === BOUNDARIES ||
        m.ruleId?.startsWith('@eslint-community/eslint-comments/'),
    );
    expect(problems.length).toBeGreaterThan(0);
  });

  it('still allows disabling other rules', async () => {
    const messages = await lintFixture(
      'apps/web/src/fixture.ts',
      '// eslint-disable-next-line no-console\nconsole.log(1);\n',
    );

    expect(errorsOf(messages, NO_DISABLE)).toHaveLength(0);
  });
});

describe('apps/web is a thin shell', () => {
  const RESTRICTED = 'no-restricted-syntax';

  it.each([
    {
      what: 'a component in another file',
      file: 'apps/web/src/app/home.ts',
      code: "import { ChangeDetectionStrategy, Component } from '@angular/core';\n\n@Component({ selector: 'hs-home', template: '', changeDetection: ChangeDetectionStrategy.OnPush })\nexport class Home {}\n",
    },
    {
      what: 'a service',
      file: 'apps/web/src/app/clock.service.ts',
      code: "import { Injectable } from '@angular/core';\n\n@Injectable({ providedIn: 'root' })\nexport class Clock {}\n",
    },
    {
      what: 'a plain class',
      file: 'apps/web/src/app/helper.ts',
      code: 'export class Helper {}\n',
    },
    {
      what: 'a service next to the root component',
      file: 'apps/web/src/app/app.component.ts',
      code: "import { Injectable } from '@angular/core';\n\n@Injectable({ providedIn: 'root' })\nexport class Clock {}\n",
    },
    {
      what: 'a second component next to the root component',
      file: 'apps/web/src/app/app.component.ts',
      code: "import { Component } from '@angular/core';\n\n@Component({ selector: 'hs-root', template: '' })\nexport class AppComponent {}\n\n@Component({ selector: 'hs-other', template: '' })\nexport class Other {}\n",
    },
  ])('fails lint for $what', async ({ file, code }) => {
    const messages = await lintFixture(file, code);

    expect(errorsOf(messages, RESTRICTED).length).toBeGreaterThan(0);
  });

  it('accepts the root component', async () => {
    const messages = await lintFixture(
      'apps/web/src/app/app.component.ts',
      "import { ChangeDetectionStrategy, Component } from '@angular/core';\n\n@Component({ selector: 'hs-root', template: '', changeDetection: ChangeDetectionStrategy.OnPush })\nexport class AppComponent {}\n",
    );

    expect(errorsOf(messages, RESTRICTED)).toEqual([]);
  });

  it('allows data-access only in app.config.ts (app-wide providers) and in tests', async () => {
    const code =
      "import * as target from '@helmstead/system-data-access';\nexport const used = target;\n";

    expect(
      errorsOf(
        await lintFixture('apps/web/src/app/app.config.ts', code),
        'no-restricted-imports',
      ),
    ).toEqual([]);
    expect(
      errorsOf(
        await lintFixture('apps/web/src/app/app.spec.ts', code),
        'no-restricted-imports',
      ),
    ).toEqual([]);
    expect(
      errorsOf(
        await lintFixture('apps/web/src/app/app.routes.ts', code),
        'no-restricted-imports',
      ),
    ).toHaveLength(1);
  });
});

describe('a type:api lib only re-exports', () => {
  const file = 'libs/web/system/api/src/index.ts';

  it.each([
    { what: 'a declaration', code: 'export const answer = 42;\n' },
    {
      what: 'an import and a local export',
      code: "import { StatusBadge } from '@helmstead/system-ui';\nexport { StatusBadge };\n",
    },
  ])('fails lint for $what in index.ts', async ({ code }) => {
    const messages = await lintFixture(file, code);

    expect(errorsOf(messages, 'no-restricted-syntax').length).toBeGreaterThan(
      0,
    );
  });

  it('accepts export … from statements', async () => {
    const messages = await lintFixture(
      file,
      "export { StatusBadge } from '@helmstead/system-ui';\nexport type * from '@helmstead/system-model';\nexport * from '@helmstead/system-model';\n",
    );

    expect(errorsOf(messages, 'no-restricted-syntax')).toEqual([]);
  });
});

describe("domain edges that need the project's own domain", () => {
  it.each([
    ['type:feature', "its own domain's type:api", SOURCE.feature, TARGET.api],
    ['type:api', 'a domain:shared type:ui', SOURCE.api, TARGET.sharedUi],
  ])('%s → %s fails lint', async (_from, _to, file, target) => {
    const messages = await lintFixture(file, importOf(target));

    expect(errorsOf(messages, 'no-restricted-imports')).toHaveLength(1);
  });
});

describe('lint fixture projects stay out of real code', () => {
  it('fails lint when a real project imports one', async () => {
    const messages = await lintFixture(
      'libs/web/system/feature/src/lib/fixture.ts',
      importOf(TARGET.util),
    );

    expect(errorsOf(messages, 'no-restricted-imports')).toHaveLength(1);
  });
});

// Spec 002 criterion 5. Sheriff owns the rules inside a project: no import past a module's index.ts.
describe('deep imports (Sheriff)', () => {
  const DEEP_IMPORT = '@softarc/sheriff/deep-import';

  it.each([
    {
      what: "another project's file past its index.ts",
      file: 'libs/web/system/feature/src/lib/fixture.ts',
      code: "import { StatusBadgeComponent } from '../../../ui/src/lib/status-badge';\nexport const used = StatusBadgeComponent;\n",
    },
    {
      what: "a folder module's file past its index.ts, inside a project",
      file: 'tools/eslint/fixtures/projects/system-util/src/fixture.ts',
      code: "import { hidden } from './internal/hidden';\nexport const used = hidden;\n",
    },
  ])('fails lint for $what', async ({ file, code }) => {
    const messages = await lintFixture(file, code);

    const errors = errorsOf(messages, DEEP_IMPORT);
    expect(errors).toHaveLength(1);
    // Sheriff reports its own failures (a missing file, a bad config) under the same rule id.
    expect(errors[0]?.message).not.toContain('internal error');
  });

  it.each([
    {
      what: "another project's index.ts through its alias",
      file: 'libs/web/system/feature/src/lib/fixture.ts',
      code: "import { StatusBadgeComponent } from '@helmstead/system-ui';\nexport const used = StatusBadgeComponent;\n",
    },
    {
      what: "a folder module's index.ts",
      file: 'tools/eslint/fixtures/projects/system-util/src/fixture.ts',
      code: "import { visible } from './internal';\nexport const used = visible;\n",
    },
  ])('passes lint for $what', async ({ file, code }) => {
    const messages = await lintFixture(file, code);

    expect(errorsOf(messages, DEEP_IMPORT)).toEqual([]);
  });

  it('leaves the dependency rules to Nx: Sheriff runs only deep-import', async () => {
    const eslint = new ESLint({
      cwd: repoRoot,
      flags: ['v10_config_lookup_from_file'],
    });
    const config = (await eslint.calculateConfigForFile(
      `${repoRoot}/libs/web/system/feature/src/index.ts`,
    )) as Linter.Config;
    const sheriffRules = Object.entries(config.rules ?? {})
      .filter(([name]) => name.startsWith('@softarc/sheriff/'))
      .filter(([, entry]) => (Array.isArray(entry) ? entry[0] : entry) !== 0)
      .map(([name]) => name);

    expect(sheriffRules).toEqual([DEEP_IMPORT]);
  });
});
