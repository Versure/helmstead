import nx from '@nx/eslint-plugin';
import sheriff from '@softarc/eslint-plugin-sheriff';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import baseConfig from '../../eslint.config.mjs';
import angularBestPractices from './eslint.angular.config.mjs';
import helmstead from './rules/contract-types.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');

// Every no-unsafe-* rule of typescript-eslint, so a rule added in an upgrade is on too (spec 002 criterion 9).
const unsafeRules = Object.fromEntries(
  Object.entries(tsPlugin.rules)
    .filter(
      ([name, rule]) => name.startsWith('no-unsafe-') && !rule.meta.deprecated,
    )
    .map(([name]) => [`@typescript-eslint/${name}`, 'error']),
);

// The ESLint config of every frontend project (`apps/web`, `libs/ui`, `libs/web/**`). A project's own
// eslint.config.mjs is one line, `export default webProject(import.meta.dirname)`, and the rules below follow the
// project's `type:` tag in its project.json, so no project can pick a looser set. docs/adr/004-frontend-architecture.md
// explains each rule; the tests are in tools/eslint/*.spec.ts.

// no-restricted-syntax options do not merge across config blocks, so every block that sets the rule repeats these.
const restrictedSyntax = (...extra) => [
  'error',
  {
    selector: 'Decorator[expression.callee.name="NgModule"]',
    message:
      'Modern Angular only: standalone components, no @NgModule (ADR-004).',
  },
  {
    selector:
      'Decorator[expression.callee.name="Component"] Property[key.name="styles"]',
    message:
      'Put component styles in a .css file (styleUrl), where Stylelint checks the Helm tokens (ADR-004).',
  },
  ...extra,
];

const web = [
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  ...baseConfig,
  ...angularBestPractices,
  {
    // Type-aware linting, for the no-unsafe-* rules and the contract-type rule.
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: repoRoot },
    },
    rules: unsafeRules,
  },
  {
    files: ['**/*.ts'],
    rules: { 'no-restricted-syntax': restrictedSyntax() },
  },
  {
    // Inside a project: no import past a module's index.ts (sheriff.config.ts). Nx owns the rules between projects,
    // so Sheriff's dependency-rule stays off.
    files: ['**/*.ts'],
    plugins: { '@softarc/sheriff': sheriff },
    rules: { '@softarc/sheriff/deep-import': 'error' },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'hs', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'hs', style: 'kebab-case' },
      ],
    },
  },
];

const HTTP_MESSAGE =
  'HTTP belongs in a type:data-access lib (ADR-004). Inject that lib’s service instead.';
const HTTP_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];

/** no-restricted-imports options for a project; ESLint does not merge options, so each project gets one set. */
const restrictedImports = ({ http, dataAccess, extra = [] }) => ({
  paths: [],
  patterns: [
    {
      group: ['@helmstead/lint-fixture-*'],
      message:
        'Lint fixture projects exist only for the boundary tests (tools/eslint/fixtures).',
    },
    ...(http
      ? [
          {
            group: ['@angular/common/http', '@angular/common/http/*'],
            message: HTTP_MESSAGE,
          },
        ]
      : []),
    ...(dataAccess
      ? [
          {
            group: ['@helmstead/*-data-access'],
            message:
              'The app uses data-access libs only for app-wide providers, in src/app/app.config.ts (ADR-004).',
          },
        ]
      : []),
    ...extra,
  ],
});

/**
 * Domain edges Nx tags cannot express (ADR-004): a feature reaches other domains through their api lib, never its own;
 * an api lib re-exports only its own domain. Import aliases are `@helmstead/<domain>-<type>`.
 */
const ownDomainRules = (type, domain) => {
  const extra = {
    'type:feature': [
      {
        group: [`@helmstead/${domain}-api`],
        message:
          'A feature uses its own domain directly; a type:api lib is for other domains (ADR-004).',
      },
    ],
    'type:api': [
      {
        group: ['@helmstead/*', `!@helmstead/${domain}-*`],
        message: `A type:api lib re-exports only its own domain (${domain}) (ADR-004).`,
      },
    ],
  }[type];

  return extra && domain
    ? [
        {
          files: ['**/*.ts'],
          rules: {
            'no-restricted-imports': [
              'error',
              restrictedImports({ http: true, extra }),
            ],
          },
        },
      ]
    : [];
};

const noHttp = {
  files: ['**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', restrictedImports({ http: true })],
    'no-restricted-globals': [
      'error',
      ...HTTP_GLOBALS.map((name) => ({ name, message: HTTP_MESSAGE })),
    ],
    'no-restricted-properties': [
      'error',
      ...['window', 'globalThis', 'self'].flatMap((object) =>
        HTTP_GLOBALS.map((property) => ({
          object,
          property,
          message: HTTP_MESSAGE,
        })),
      ),
    ],
  },
};

const byType = {
  'type:app': [
    noHttp,
    {
      // Tests may replace a data-access service with a stand-in.
      files: ['src/**/*.ts'],
      ignores: ['src/app/app.config.ts', 'src/**/*.spec.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          restrictedImports({ http: true, dataAccess: true }),
        ],
      },
    },
    {
      // The app is bootstrap, config, root routes and the root component. Everything else lives in a lib.
      files: ['src/**/*.ts'],
      ignores: ['src/app/app.ts', 'src/**/*.spec.ts'],
      rules: {
        'no-restricted-syntax': restrictedSyntax({
          selector: 'ClassDeclaration',
          message:
            'apps/web declares only the root component (src/app/app.ts). Put components and services in a lib under libs/web/<domain>/<type> (ADR-004).',
        }),
      },
    },
    {
      files: ['src/app/app.ts'],
      rules: {
        'no-restricted-syntax': restrictedSyntax(
          {
            selector:
              'Decorator[expression.callee.name=/^(Injectable|Directive|Pipe)$/]',
            message:
              'apps/web declares only the root component. Put services, directives and pipes in a lib (ADR-004).',
          },
          {
            selector: 'ClassDeclaration:not([id.name="App"])',
            message:
              'apps/web/src/app/app.ts declares only the root component, App (ADR-004).',
          },
        ),
      },
    },
  ],
  'type:feature': [noHttp],
  'type:ui': [noHttp],
  'type:model': [noHttp],
  'type:util': [noHttp],
  'type:api': [
    noHttp,
    {
      files: ['src/index.ts'],
      rules: {
        'no-restricted-syntax': restrictedSyntax({
          selector:
            'Program > :not(ExportNamedDeclaration[source], ExportAllDeclaration)',
          message:
            'A type:api lib only re-exports its domain’s public parts: use `export … from` (ADR-004).',
        }),
      },
    },
  ],
  'type:data-access': [
    {
      files: ['**/*.ts'],
      plugins: { helmstead },
      rules: {
        'no-restricted-imports': ['error', restrictedImports({ http: false })],
        'helmstead/contract-types': 'error',
      },
    },
  ],
};

const dependencyChecks = {
  // Buildable libraries list what they import in their package.json.
  files: ['**/*.json'],
  rules: {
    '@nx/dependency-checks': [
      'error',
      {
        ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}'],
      },
    ],
  },
  languageOptions: {
    parser: await import('jsonc-eslint-parser'),
  },
};

/** The ESLint config of the frontend project in `projectDir`, chosen by the `type:` tag in its project.json. */
export function webProject(projectDir) {
  const project = JSON.parse(
    readFileSync(path.join(projectDir, 'project.json'), 'utf8'),
  );
  const type = (project.tags ?? []).find((tag) => tag.startsWith('type:'));
  const domain = (project.tags ?? [])
    .find((tag) => tag.startsWith('domain:'))
    ?.slice('domain:'.length);
  const rules = byType[type];
  if (!rules) {
    throw new Error(
      `${path.join(projectDir, 'project.json')} has type tag "${type}", which has no frontend lint rules. ` +
        `Known: ${Object.keys(byType).join(', ')} (docs/adr/004-frontend-architecture.md).`,
    );
  }

  return [
    ...web,
    ...rules,
    ...ownDomainRules(type, domain),
    ...(project.projectType === 'library' ? [dependencyChecks] : []),
  ];
}
