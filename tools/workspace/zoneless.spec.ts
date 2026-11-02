import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Spec 002 criterion 11: apps/web runs without zone.js.
const repoRoot = path.resolve(import.meta.dirname, '../..');
const json = (file: string) =>
  JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8'));

describe('apps/web is zoneless', () => {
  it('has no zone.js in the workspace dependencies', () => {
    const { dependencies = {}, devDependencies = {} } = json('package.json');

    expect(Object.keys({ ...dependencies, ...devDependencies })).not.toContain(
      'zone.js',
    );
  });

  it('loads no zone.js polyfill in any build or test target', () => {
    const { targets } = json('apps/web/project.json');
    const polyfills = Object.values(
      targets as Record<string, { options?: { polyfills?: string[] } }>,
    ).flatMap((target) => target.options?.polyfills ?? []);

    expect(polyfills.filter((p) => p.startsWith('zone.js'))).toEqual([]);
  });
});
