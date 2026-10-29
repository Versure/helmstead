import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOKENS_CSS, TOKENS_JSON, tokensToCss } from './port-helm-tokens.mjs';

// Spec 002 criterion 12: libs/ui holds the Helm tokens, ported from the design system artifact, for both themes.
const json = JSON.parse(readFileSync(TOKENS_JSON, 'utf8'));
const css = readFileSync(TOKENS_CSS, 'utf8');

describe('the Helm tokens in libs/ui', () => {
  it('are the CSS generated from the design system tokens (run tools/design/port-helm-tokens.mjs)', () => {
    expect(css).toBe(tokensToCss(json));
  });

  it('come from the Helm design system with its two themes, Night harbor (default) and Day', () => {
    expect(json.name).toBe('Helmstead');
    expect(json.color.themes).toEqual([
      { id: 'dark', name: 'Night harbor' },
      { id: 'light', name: 'Day' },
    ]);
  });

  it.each([
    ['--helm-ground: #0a0f1c;', ':root'],
    ['--helm-ground: #f3f5fa;', "[data-theme='light']"],
    ['--helm-ok: #3fd4c4;', ':root'],
    ['--helm-ok: #0b7a71;', "[data-theme='light']"],
    ['--helm-space-6: 24px;', ':root'],
    ['--helm-radius-pill: 999px;', ':root'],
    ['--helm-font-size-label: 11px;', ':root'],
  ])('defines %s under %s', (declaration, selector) => {
    const block = css.slice(css.indexOf(`${selector} {`));

    expect(block.slice(0, block.indexOf('}'))).toContain(declaration);
  });

  it('defines every colour and shadow token in every theme', () => {
    const themed = [...json.color.tokens, ...json.shadow.tokens].map(
      (token: { name: string }) => `--helm-${token.name}:`,
    );
    const blocks = css
      .split(/^(?=:root)/m)
      .filter((b) => b.startsWith(':root'));

    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(themed.filter((name) => !block.includes(name))).toEqual([]);
    }
  });
});

describe('porting a new version of the tokens', () => {
  it.each([
    'url(https://example.com/x.png)',
    '#fff; } body { display: none',
    '@import "x"',
    '#fff /* comment */',
  ])('refuses a value that is not a plain token: %s', (value) => {
    const tampered = structuredClone(json);
    tampered.color.tokens[0].value.dark = value;

    expect(() => tokensToCss(tampered)).toThrow(/not a plain token value/);
  });
});
