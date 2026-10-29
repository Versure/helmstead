import { readFileSync } from 'node:fs';
import path from 'node:path';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';

// Spec 002 criterion 13: styles use the Helm design tokens. Fixtures are linted as text at a path inside a real
// project, with the workspace's stylelint.config.mjs, so they never become part of a build.
const repoRoot = path.resolve(import.meta.dirname, '../..');
const COMPONENT = 'libs/web/system/ui/src/lib/fixture.css';

async function lint(code: string, file = COMPONENT) {
  const { results } = await stylelint.lint({
    code,
    codeFilename: path.join(repoRoot, file),
    cwd: repoRoot,
  });
  const [result] = results;
  return {
    ignored: result?.ignored ?? false,
    rules: (result?.warnings ?? []).map((w) => w.rule),
  };
}

describe('raw values fail Stylelint', () => {
  it.each([
    { group: 'a hex colour', code: '.a { color: #ff0000; }' },
    { group: 'an rgb() colour', code: '.a { background: rgb(0 0 0 / 50%); }' },
    { group: 'an hsl() colour', code: '.a { border-color: hsl(0deg 0% 0%); }' },
    { group: 'a named colour', code: '.a { color: red; }' },
    {
      group: 'a colour inside a shorthand',
      code: '.a { border: 1px solid #000; }',
    },
    {
      group: 'a colour in a shadow',
      code: '.a { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); }',
    },
    { group: 'a raw margin', code: '.a { margin: 8px; }' },
    {
      group: 'a raw padding',
      code: '.a { padding: 0 var(--helm-space-2) 0 9px; }',
    },
    { group: 'a raw logical padding', code: '.a { padding-inline: 1rem; }' },
    { group: 'a raw gap', code: '.a { gap: 6px; }' },
    { group: 'a raw row-gap', code: '.a { row-gap: 4px; }' },
    { group: 'a raw inset', code: '.a { inset: 4px; }' },
    {
      group: 'a raw inset-block-start',
      code: '.a { inset-block-start: 2px; }',
    },
    { group: 'a raw font-size', code: '.a { font-size: 14px; }' },
    {
      group: 'a raw font-family',
      code: '.a { font-family: Arial, sans-serif; }',
    },
    { group: 'a font shorthand', code: '.a { font: 600 11px/1 sans-serif; }' },
    { group: 'a raw border-radius', code: '.a { border-radius: 6px; }' },
    {
      group: 'a raw corner radius',
      code: '.a { border-top-left-radius: 50%; }',
    },
    {
      group: 'a variable outside the Helm tokens',
      code: '.a { gap: var(--my-gap); }',
    },
  ])('fails for $group', async ({ code }) => {
    const { ignored, rules } = await lint(code);

    expect(ignored).toBe(false);
    expect(rules.length).toBeGreaterThan(0);
  });

  it('checks styles in apps/web too', async () => {
    const { rules } = await lint(
      '.a { color: #fff; }',
      'apps/web/src/styles.css',
    );

    expect(rules.length).toBeGreaterThan(0);
  });
});

describe('token values pass Stylelint', () => {
  it('accepts var(--helm-*), 0, inherit, transparent and currentColor', async () => {
    const { rules } = await lint(`
.a {
  color: var(--helm-ink);
  background: transparent;
  border: 1px solid currentColor;
  border-color: var(--helm-line-strong);
  box-shadow: var(--helm-shadow-panel);
  margin: 0;
  padding: var(--helm-space-3) var(--helm-space-4);
  padding-inline-start: inherit;
  gap: var(--helm-space-2);
  inset: 0;
  font-size: var(--helm-font-size-body);
  font-family: var(--helm-font-sans);
  border-radius: var(--helm-radius-pill);
  width: 7px;
}
`);

    expect(rules).toEqual([]);
  });

  it('exempts the token files in libs/ui', async () => {
    const { ignored } = await lint(
      ':root { --helm-ground: #0a0f1c; }',
      'libs/ui/src/tokens/fixture.css',
    );

    expect(ignored).toBe(true);
  });
});

describe('verification runs Stylelint', () => {
  it('has a Stylelint step in verify.mjs that fails the run on an error', () => {
    const verify = readFileSync(
      path.join(repoRoot, 'scripts/sdlc/verify.mjs'),
      'utf8',
    );

    expect(verify).toMatch(
      /\{ name: 'stylelint[^}]*bin: binOf\('stylelint'\)[^}]*'apps\/web\/\*\*\/\*\.\{css,scss\}'[^}]*'libs\/\*\*\/\*\.\{css,scss\}'/,
    );
  });
});
