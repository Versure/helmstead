import { createProjectGraphAsync } from '@nx/devkit';
import { describe, expect, it } from 'vitest';
import { checkScopeTags } from './scope-tags';

describe('checkScopeTags', () => {
  it('accepts projects that carry exactly one scope tag', () => {
    const errors = checkScopeTags([
      { name: 'web', tags: ['scope:web'] },
      { name: 'core', tags: ['scope:core', 'type:app'] },
    ]);

    expect(errors).toEqual([]);
  });

  it('fails a project without a scope tag', () => {
    const errors = checkScopeTags([
      { name: 'orphan', tags: [] },
      { name: 'other-tags', tags: ['type:app'] },
    ]);

    expect(errors).toEqual([
      'Project "orphan" has no scope: tag; it needs exactly one.',
      'Project "other-tags" has no scope: tag; it needs exactly one.',
    ]);
  });

  it('fails a project with more than one scope tag', () => {
    const errors = checkScopeTags([
      { name: 'double', tags: ['scope:web', 'scope:core'] },
    ]);

    expect(errors).toEqual([
      'Project "double" has 2 scope: tags (scope:web, scope:core); it needs exactly one.',
    ]);
  });

  it('fails a scope that is not one of the known scopes', () => {
    const errors = checkScopeTags([{ name: 'odd', tags: ['scope:mobile'] }]);

    expect(errors).toEqual([
      'Project "odd" uses unknown tag "scope:mobile"; known scopes are scope:web, scope:core, scope:shared.',
    ]);
  });
});

describe('the workspace', () => {
  it('has exactly one scope: tag on every Nx project', async () => {
    const graph = await createProjectGraphAsync();
    const projects = Object.values(graph.nodes).map((node) => ({
      name: node.name,
      tags: node.data.tags ?? [],
    }));

    expect(projects.map((p) => p.name).sort()).toEqual([
      'api-contracts',
      'core',
      'ui',
      'web',
    ]);
    expect(checkScopeTags(projects)).toEqual([]);
  });

  it('gives each project the scope the spec asks for', async () => {
    const graph = await createProjectGraphAsync();
    const scopeOf = (name: string) =>
      (graph.nodes[name].data.tags ?? []).filter((t) => t.startsWith('scope:'));

    expect(scopeOf('web')).toEqual(['scope:web']);
    expect(scopeOf('ui')).toEqual(['scope:web']);
    expect(scopeOf('core')).toEqual(['scope:core']);
    expect(scopeOf('api-contracts')).toEqual(['scope:shared']);
  });
});
