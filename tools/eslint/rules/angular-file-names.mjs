import path from 'node:path';

// The owner's naming convention (docs/adr/004-frontend-architecture.md): a file name says what the file holds, so
// `status-badge.component.ts`, not `status-badge.ts`. Each Angular class lives in `<name>.<kind>.ts`, its class name
// ends in the kind, and a component's template and styles are `<name>.component.html` / `.css` next to it.
// Components, directives and pipes each live in a folder of their own, `<name>/<name>.component.ts`, so a lib with
// many of them stays organised (the root `src/app/app.component.ts` already fits). Services may share a folder.
// Spec files are exempt: a test may declare a host component inline.

const KINDS = {
  Component: 'component',
  Directive: 'directive',
  Pipe: 'pipe',
  Injectable: 'service',
};

const decoratorName = (decorator) =>
  decorator.expression.type === 'CallExpression' &&
  decorator.expression.callee.type === 'Identifier'
    ? decorator.expression.callee.name
    : undefined;

/** The string values of templateUrl, styleUrl and styleUrls in a @Component({...}) call. */
function resourceUrls(decorator) {
  const [options] = decorator.expression.arguments;
  if (options?.type !== 'ObjectExpression') return [];
  return options.properties.flatMap((property) => {
    if (property.type !== 'Property' || property.key.type !== 'Identifier')
      return [];
    const values =
      property.value.type === 'ArrayExpression'
        ? property.value.elements
        : [property.value];
    return ['templateUrl', 'styleUrl', 'styleUrls'].includes(property.key.name)
      ? values
          .filter((v) => v?.type === 'Literal' && typeof v.value === 'string')
          .map((v) => ({ node: v, url: v.value }))
      : [];
  });
}

export const angularFileNames = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Angular classes live in <name>.component|directive|pipe|service.ts, with a class name and resources to match.',
    },
    messages: {
      fileName:
        'A {{decorator}} belongs in a file named <name>.{{kind}}.ts; this file is {{file}}.',
      className:
        'A {{decorator}} class name ends in {{suffix}}: rename {{name}}.',
      folder:
        'Put {{file}} in a folder of its own: {{base}}/{{file}} (with its template, styles and spec).',
      resource:
        '{{url}} does not match the component file; use ./{{base}}.component.{{ext}}.',
    },
    schema: [],
  },
  create(context) {
    const file = path.basename(context.filename);
    if (/\.spec\.ts$/.test(file)) return {};

    return {
      ClassDeclaration(node) {
        for (const decorator of node.decorators ?? []) {
          const name = decoratorName(decorator);
          const kind = name && KINDS[name];
          if (!kind) continue;

          // Temporary lint-fixture files insert `.lint-fixture-<pid>-<n>` before the extension part.
          const plain = file.replace(/\.lint-fixture-\d+-\d+/, '');
          if (!plain.endsWith(`.${kind}.ts`)) {
            context.report({
              node: decorator,
              messageId: 'fileName',
              data: { decorator: `@${name}`, kind, file },
            });
          }
          if (kind !== 'service' && plain.endsWith(`.${kind}.ts`)) {
            const base = plain.slice(0, -`.${kind}.ts`.length);
            if (path.basename(path.dirname(context.filename)) !== base) {
              context.report({
                node: decorator,
                messageId: 'folder',
                data: { file: plain, base },
              });
            }
          }
          const suffix = kind[0].toUpperCase() + kind.slice(1);
          if (node.id && !node.id.name.endsWith(suffix)) {
            context.report({
              node: node.id,
              messageId: 'className',
              data: { decorator: `@${name}`, suffix, name: node.id.name },
            });
          }
          if (kind === 'component' && plain.endsWith('.component.ts')) {
            const base = plain.slice(0, -'.component.ts'.length);
            for (const { node: urlNode, url } of resourceUrls(decorator)) {
              const ext = path.extname(url).slice(1) || 'html';
              if (url !== `./${base}.component.${ext}`) {
                context.report({
                  node: urlNode,
                  messageId: 'resource',
                  data: { url, base, ext },
                });
              }
            }
          }
        }
      },
    };
  },
};
