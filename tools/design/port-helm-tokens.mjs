#!/usr/bin/env node
// Writes libs/ui/src/tokens/helm-tokens.css from libs/ui/src/tokens/helm-tokens.json, the token file of the Helm design
// system artifact (https://claude.ai/artifact/XQDpkg4gRzfwJRABL1gxjg, project/tokens.json). To take a new version of
// the design system: replace the JSON with the artifact's file and run `node tools/design/port-helm-tokens.mjs`.
// tools/design/helm-tokens.spec.ts fails when the CSS and the JSON disagree.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');
export const TOKENS_JSON = path.join(
  repoRoot,
  'libs/ui/src/tokens/helm-tokens.json',
);
export const TOKENS_CSS = path.join(
  repoRoot,
  'libs/ui/src/tokens/helm-tokens.css',
);

const kebab = (name) =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const valueIn = (value, theme) =>
  typeof value === 'string' ? value : value[theme];

/** The CSS for a parsed tokens.json: the first theme on :root (the default), every other theme under [data-theme]. */
export function tokensToCss(tokens) {
  const [defaultTheme, ...otherThemes] = tokens.color.themes;
  const themed = [...tokens.color.tokens, ...(tokens.shadow?.tokens ?? [])];
  const fixed = [];

  for (const [family, stack] of Object.entries(tokens.type.families)) {
    fixed.push([`font-${family}`, stack]);
  }
  for (const group of tokens.type.groups) {
    for (const style of group.styles) {
      fixed.push([`font-size-${style.name}`, style.fontSize]);
      fixed.push([`line-height-${style.name}`, style.lineHeight]);
      fixed.push([`font-weight-${style.name}`, String(style.fontWeight)]);
      if (style.letterSpacing)
        fixed.push([`letter-spacing-${style.name}`, style.letterSpacing]);
    }
  }
  for (const family of ['spacing', 'radius']) {
    for (const token of tokens[family]?.tokens ?? [])
      fixed.push([token.name, token.value]);
  }

  const declarations = (entries) =>
    entries
      .map(([name, value]) => `  --helm-${kebab(name)}: ${value};`)
      .join('\n');
  const themeBlock = (theme) =>
    declarations(
      themed.map((token) => [
        token.name,
        valueIn(token.value, theme.id) ?? valueIn(token.value, defaultTheme.id),
      ]),
    );

  return `/* Helm design system tokens (${tokens.name}, version ${tokens.version}). Generated from helm-tokens.json by
   tools/design/port-helm-tokens.mjs; do not edit by hand. Default theme: ${defaultTheme.name} (${defaultTheme.id}).
   Other themes apply with data-theme on the root element: ${otherThemes.map((t) => `[data-theme='${t.id}'] = ${t.name}`).join(', ')}. */
:root {
  color-scheme: ${defaultTheme.id};
${declarations(fixed)}
${themeBlock(defaultTheme)}
}
${otherThemes
  .map(
    (theme) => `
:root[data-theme='${theme.id}'] {
  color-scheme: ${theme.id};
${themeBlock(theme)}
}
`,
  )
  .join('')}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(
    TOKENS_CSS,
    tokensToCss(JSON.parse(readFileSync(TOKENS_JSON, 'utf8'))),
  );
  console.log(`Wrote ${path.relative(repoRoot, TOKENS_CSS)}`);
}
