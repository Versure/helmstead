// Styles use the Helm design tokens (spec 002 criterion 13, docs/adr/004-frontend-architecture.md): no raw colour
// anywhere, and spacing, font size, font family and corner radius only from `var(--helm-*)`. The token files in
// libs/ui/src/tokens are the one place that holds raw values. Tested in tools/stylelint/stylelint.spec.ts.

// One value: a Helm token, 0, or a keyword that adds no value of its own.
const TOKEN = String.raw`(?:var\(--helm-[a-z0-9-]+\)|0|inherit|transparent|currentColor)`;
// Shorthands such as `padding: a b c d` take up to four of them.
const TOKENS = new RegExp(String.raw`^${TOKEN}(?:\s+${TOKEN}){0,3}$`);
const TOKEN_MESSAGE = (property, value) =>
  `"${property}: ${value}" is a raw value. Use a Helm token, var(--helm-*), from libs/ui/src/tokens.`;

export default {
  ignoreFiles: ['libs/ui/src/tokens/**', '**/dist/**', '**/node_modules/**'],
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [
      [
        'rgb',
        'rgba',
        'hsl',
        'hsla',
        'hwb',
        'lab',
        'lch',
        'oklab',
        'oklch',
        'color',
      ],
      { message: 'Raw colours belong in the Helm tokens. Use var(--helm-*).' },
    ],
    'declaration-property-value-allowed-list': [
      {
        '/^(margin|padding)(-.+)?$/': [TOKENS],
        '/^(gap|row-gap|column-gap)$/': [TOKENS],
        '/^inset(-.+)?$/': [TOKENS],
        'font-size': [TOKENS],
        'font-family': [TOKENS],
        font: [TOKENS],
        '/^border(-.+)?-radius$/': [TOKENS],
      },
      { message: TOKEN_MESSAGE },
    ],
  },
};
