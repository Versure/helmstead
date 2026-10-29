import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';

// Angular best practices for every `scope:web` project. Changing this file changes what the owner agreed to,
// so the risk gate treats `tools/**` as high risk. Tested in `tools/eslint/angular.spec.ts`.
export default [
  ...tseslint.configs.strict.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  // The angular-eslint presets carry no `files`, so scope them here or the template parser takes over `.ts` files.
  ...angular.configs.tsRecommended.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  ...angular.configs.templateRecommended.map((config) => ({
    ...config,
    files: ['**/*.html'],
  })),
  ...angular.configs.templateAccessibility.map((config) => ({
    ...config,
    files: ['**/*.html'],
  })),
  {
    files: ['**/*.ts'],
    rules: {
      // Modern Angular only: signals, inject(), OnPush, standalone.
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/prefer-inject': 'error',
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-signal-model': 'error',
      '@angular-eslint/prefer-standalone': 'error',
      '@angular-eslint/prefer-output-emitter-ref': 'error',
      '@angular-eslint/prefer-output-readonly': 'error',
      '@angular-eslint/prefer-host-metadata-property': 'error',
      '@angular-eslint/use-injectable-provided-in': 'error',
      '@angular-eslint/inject-at-top': 'error',
      '@angular-eslint/computed-must-return': 'error',
      '@angular-eslint/no-implicit-take-until-destroyed': 'error',
      '@angular-eslint/no-async-lifecycle-method': 'error',
      '@angular-eslint/no-lifecycle-call': 'error',
      '@angular-eslint/no-forward-ref': 'error',
      '@angular-eslint/no-pipe-impure': 'error',
      '@angular-eslint/no-input-prefix': ['error', { prefixes: ['on'] }],
      '@angular-eslint/use-component-selector': 'error',
      '@angular-eslint/relative-url-prefix': 'error',
      '@angular-eslint/consistent-component-styles': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // Components, directives and services are classes without members of their own.
      '@typescript-eslint/no-extraneous-class': [
        'error',
        { allowWithDecorator: true },
      ],
    },
  },
  {
    files: ['**/*.html'],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/prefer-ngsrc': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/prefer-class-binding': 'error',
      '@angular-eslint/template/prefer-contextual-for-variables': 'error',
      '@angular-eslint/template/prefer-at-else': 'error',
      '@angular-eslint/template/prefer-at-empty': 'error',
      '@angular-eslint/template/prefer-built-in-pipes': 'error',
      '@angular-eslint/template/no-call-expression': 'error',
      '@angular-eslint/template/no-negated-async': 'error',
      '@angular-eslint/template/no-inline-styles': 'error',
      '@angular-eslint/template/no-interpolation-in-attributes': 'error',
      '@angular-eslint/template/no-nested-tags': 'error',
      '@angular-eslint/template/no-empty-control-flow': 'error',
      '@angular-eslint/template/button-has-type': 'error',
      '@angular-eslint/template/eqeqeq': 'error',
      '@angular-eslint/template/use-track-by-function': 'error',
      '@angular-eslint/template/require-switch-default': 'error',
    },
  },
];
