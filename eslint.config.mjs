import nx from '@nx/eslint-plugin';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import { FRONTEND_DOMAINS } from './tools/workspace/frontend-tags.mjs';

// The allowed edges between projects are defined in docs/adr/002-module-boundaries.md (scopes) and
// docs/adr/004-frontend-architecture.md (domains and layers). A project must satisfy every constraint whose
// sourceTag it carries, so a frontend lib passes only an edge that its scope, its type and its domain all allow.
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
          allow: [
            '^.*/eslint(\\.base|\\.angular|\\.web)?\\.config\\.[cm]?[jt]s$',
          ],
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
            // Frontend layers. An app may use data-access only for app-wide providers: the import is allowed here
            // and limited to app.config.ts by no-restricted-imports below.
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:ui',
                'type:util',
                'type:model',
                'type:api',
                'type:data-access',
              ],
            },
            {
              // type:api is here only so a feature can use another domain's api lib. Its own domain's api lib is
              // forbidden by no-restricted-imports in tools/eslint/eslint.web.config.mjs (tags cannot say "another").
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:ui',
                'type:data-access',
                'type:model',
                'type:util',
                'type:api',
              ],
            },
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: [
                'type:model',
                'type:util',
                'type:contracts',
              ],
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:model', 'type:util'],
            },
            {
              sourceTag: 'type:model',
              onlyDependOnLibsWithTags: ['type:util'],
            },
            {
              sourceTag: 'type:util',
              onlyDependOnLibsWithTags: ['type:util'],
            },
            {
              // Only re-exports (see the no-restricted-syntax rule for api index files); the domain constraint
              // below keeps these edges inside the api lib's own domain.
              sourceTag: 'type:api',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:ui',
                'type:data-access',
                'type:model',
              ],
            },
            // Frontend domains: a domain uses itself, shared, and other domains only through their type:api lib.
            ...FRONTEND_DOMAINS.map((domain) => ({
              sourceTag: `domain:${domain}`,
              onlyDependOnLibsWithTags: [
                `domain:${domain}`,
                'domain:shared',
                'type:api',
              ],
            })),
            {
              sourceTag: 'domain:shared',
              onlyDependOnLibsWithTags: ['domain:shared'],
            },
          ],
        },
      ],
    },
  },
  {
    // A boundary rule that can be switched off with a comment is not a rule. Templates too: a template rule
    // switched off would let a raw inline style past Stylelint.
    files: [
      '**/*.html',
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
        // The frontend rules of ADR-004: HTTP only in data-access, thin app shell, api re-exports, Angular style,
        // deep imports and contract types.
        'no-restricted-imports',
        'no-restricted-globals',
        'no-restricted-properties',
        'no-restricted-syntax',
        '@softarc/sheriff/*',
        'helmstead/*',
        '@typescript-eslint/no-explicit-any',
        '@typescript-eslint/no-unsafe-*',
      ],
    },
  },
];
