import { describe, expect, it } from 'vitest';
import { errorsOf, lintFixture } from './lint-fixture';

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
      edge: 'scope:web (app) importing scope:shared',
      file: 'apps/web/src/fixture.ts',
      code: "import type { components } from '@helmstead/api-contracts';\nexport type T = components;\n",
    },
    {
      edge: 'scope:web (app) importing a scope:web lib',
      file: 'apps/web/src/fixture.ts',
      code: "import { Ui } from '@helmstead/ui';\nconsole.log(Ui);\n",
    },
    {
      edge: 'scope:web (lib) importing scope:shared',
      file: 'libs/ui/src/fixture.ts',
      code: "import type { components } from '@helmstead/api-contracts';\nexport type T = components;\n",
    },
  ])('reports no boundary error for $edge', async ({ file, code }) => {
    const messages = await lintFixture(file, code);

    expect(errorsOf(messages, BOUNDARIES)).toHaveLength(0);
  });
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
  ])('fails lint for $how', async ({ code }) => {
    const messages = await lintFixture('apps/web/src/fixture.ts', code);

    const problems = [
      ...errorsOf(messages, NO_DISABLE),
      ...errorsOf(messages, BOUNDARIES),
    ];
    expect(problems.length).toBeGreaterThan(0);
    expect(errorsOf(messages, NO_DISABLE).length).toBeGreaterThan(0);
  });

  it('still allows disabling other rules', async () => {
    const messages = await lintFixture(
      'apps/web/src/fixture.ts',
      '// eslint-disable-next-line no-console\nconsole.log(1);\n',
    );

    expect(errorsOf(messages, NO_DISABLE)).toHaveLength(0);
  });
});
