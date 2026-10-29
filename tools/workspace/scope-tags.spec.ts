import { createProjectGraphAsync } from '@nx/devkit';
import { describe, expect, it } from 'vitest';
import { checkFrontendTags, checkScopeTags } from './scope-tags';

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

describe('checkFrontendTags', () => {
  it('accepts frontend libs with one domain and one type tag, and the app with type:app', () => {
    const errors = checkFrontendTags([
      { name: 'web', root: 'apps/web', tags: ['scope:web', 'type:app'] },
      {
        name: 'ui',
        root: 'libs/ui',
        tags: ['scope:web', 'domain:shared', 'type:ui'],
      },
      {
        name: 'system-feature',
        root: 'libs/web/system/feature',
        tags: ['scope:web', 'domain:system', 'type:feature'],
      },
      // Not a frontend project: no domain or type tags needed.
      { name: 'core', root: 'apps/core', tags: ['scope:core'] },
    ]);

    expect(errors).toEqual([]);
  });

  it.each([
    {
      tags: ['scope:web', 'type:feature'],
      error:
        'Frontend project "lib" has no domain: tag; it needs exactly one (domain:<name> or domain:shared).',
    },
    {
      tags: ['scope:web', 'domain:system', 'domain:shared', 'type:ui'],
      error:
        'Frontend project "lib" has 2 domain: tags (domain:system, domain:shared); it needs exactly one.',
    },
    {
      tags: ['scope:web', 'domain:billing', 'type:ui'],
      error:
        'Frontend project "lib" uses domain "domain:billing", which has no boundary rule; add "billing" to tools/workspace/frontend-tags.mjs.',
    },
    {
      tags: ['scope:web', 'domain:system'],
      error:
        'Frontend project "lib" has no type: tag; it needs exactly one of type:feature, type:ui, type:data-access, type:model, type:util, type:api.',
    },
    {
      tags: ['scope:web', 'domain:system', 'type:ui', 'type:model'],
      error:
        'Frontend project "lib" has 2 type: tags (type:ui, type:model); it needs exactly one.',
    },
    {
      tags: ['scope:web', 'domain:system', 'type:service'],
      error:
        'Frontend project "lib" uses unknown tag "type:service"; known types are type:feature, type:ui, type:data-access, type:model, type:util, type:api.',
    },
  ])('fails a lib tagged $tags', ({ tags, error }) => {
    expect(
      checkFrontendTags([{ name: 'lib', root: 'libs/web/system/lib', tags }]),
    ).toEqual([error]);
  });

  it('checks libs/ui like the libs under libs/web', () => {
    expect(
      checkFrontendTags([{ name: 'ui', root: 'libs/ui', tags: ['scope:web'] }]),
    ).toHaveLength(2);
  });

  it.each([
    { tags: ['scope:web'] },
    { tags: ['scope:web', 'type:feature'] },
    { tags: ['scope:web', 'type:app', 'domain:system'] },
  ])('fails the app tagged $tags', ({ tags }) => {
    expect(
      checkFrontendTags([{ name: 'web', root: 'apps/web', tags }]),
    ).toEqual(['Frontend app "web" must carry type:app and no domain: tag.']);
  });
});

describe('the workspace', () => {
  it('has exactly one scope: tag on every Nx project', async () => {
    const graph = await createProjectGraphAsync();
    const projects = workspaceProjects(graph);

    // Every .NET project is an Nx project (the @nx/dotnet plugin infers them from the .csproj files). A new
    // project has to be added here on purpose, with its scope tag next to it.
    expect(projects.map((p) => p.name).sort()).toEqual([
      'Helmstead.Agents.Fixture',
      'Helmstead.Connectors.FixtureA',
      'Helmstead.Connectors.FixtureB',
      'Helmstead.Core.Api.Fixture',
      'Helmstead.Providers.Fixture',
      'Helmstead.Web.Fixture',
      'api-contracts',
      'core',
      'core-tests',
      'system-api',
      'system-data-access',
      'system-feature',
      'system-model',
      'system-ui',
      'ui',
      'web',
    ]);
    expect(checkScopeTags(projects)).toEqual([]);
  });

  it('has one domain: and one type: tag on every frontend project', async () => {
    const graph = await createProjectGraphAsync();

    expect(checkFrontendTags(workspaceProjects(graph))).toEqual([]);
  });

  it('gives each project the scope the spec asks for', async () => {
    const graph = await createProjectGraphAsync();
    const scopeOf = (name: string) =>
      (graph.nodes[name].data.tags ?? []).filter((t) => t.startsWith('scope:'));

    expect(scopeOf('web')).toEqual(['scope:web']);
    expect(scopeOf('ui')).toEqual(['scope:web']);
    expect(scopeOf('core')).toEqual(['scope:core']);
    expect(scopeOf('core-tests')).toEqual(['scope:core']);
    expect(scopeOf('api-contracts')).toEqual(['scope:shared']);
  });
});

// The lint fixture projects under tools/eslint/fixtures exist only to give the boundary tests something to import.
// They are not real projects, so the tag checks leave them out (spec 002, "Notes for the build").
function workspaceProjects(
  graph: Awaited<ReturnType<typeof createProjectGraphAsync>>,
) {
  return Object.values(graph.nodes)
    .filter((node) => !node.data.root.startsWith('tools/eslint/fixtures/'))
    .map((node) => ({
      name: node.name,
      root: node.data.root,
      tags: node.data.tags ?? [],
    }));
}
