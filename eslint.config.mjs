import nx from '@nx/eslint-plugin';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';

// The allowed edges between projects are defined in docs/adr/002-module-boundaries.md.
// Changing this file changes those rules, so the risk gate treats it as high risk.
export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/vitest.config.*.timestamp*'],
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base|\\.angular)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: 'scope:web',
              onlyDependOnLibsWithTags: ['scope:web', 'scope:shared'],
            },
            {
              sourceTag: 'scope:core',
              onlyDependOnLibsWithTags: ['scope:core', 'scope:shared'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
          ],
        },
      ],
    },
  },
  {
    // A boundary rule that can be switched off with a comment is not a rule.
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    plugins: { '@eslint-community/eslint-comments': eslintComments },
    rules: {
      // Only line-scoped disables are allowed at all: no `/* eslint rule: 'off' */`, no file-level
      // `/* eslint-disable */`, no `/* eslint-enable */`. That leaves no way to switch a rule off for a file.
      '@eslint-community/eslint-comments/no-use': [
        'error',
        { allow: ['eslint-disable-line', 'eslint-disable-next-line'] },
      ],
      // The boundary rule, and the rules that protect it, cannot be disabled even for one line.
      '@eslint-community/eslint-comments/no-restricted-disable': [
        'error',
        '@nx/enforce-module-boundaries',
        '@angular-eslint/*',
        '@eslint-community/eslint-comments/*',
      ],
    },
  },
];
