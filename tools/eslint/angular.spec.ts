import { describe, expect, it } from 'vitest';
import { errorsOf, lintFixture } from './lint-fixture';

const component = (
  decorator: string,
  body = '',
) => `import { Component } from '@angular/core';

@Component({
  selector: 'hs-fixture',
  ${decorator}
})
export class FixtureComponent {
${body}}
`;

describe('Angular best practices are enforced in web projects', () => {
  it.each([
    {
      practice: 'OnPush change detection (no opting out)',
      rule: '@angular-eslint/prefer-on-push-component-change-detection',
      file: 'apps/web/src/app/fixture.ts',
      code: component(
        "template: '', changeDetection: ChangeDetectionStrategy.Default",
      ).replace(
        'import { Component }',
        'import { ChangeDetectionStrategy, Component }',
      ),
    },
    {
      practice: 'inject() instead of constructor injection',
      rule: '@angular-eslint/prefer-inject',
      file: 'libs/ui/src/lib/fixture.ts',
      code: `import { Injectable } from '@angular/core';
import { Other } from './other';

@Injectable({ providedIn: 'root' })
export class FixtureService {
  constructor(private readonly other: Other) {}
}
`,
    },
    {
      practice: 'signal inputs instead of @Input()',
      rule: '@angular-eslint/prefer-signals',
      file: 'apps/web/src/app/fixture.ts',
      code: component(
        "template: '', changeDetection: ChangeDetectionStrategy.OnPush",
        '  @Input() name = "";\n',
      ).replace(
        'import { Component }',
        'import { ChangeDetectionStrategy, Component, Input }',
      ),
    },
    {
      practice: 'no `any`',
      rule: '@typescript-eslint/no-explicit-any',
      file: 'apps/web/src/app/fixture.ts',
      code: 'export const value: any = 1;\n',
    },
    {
      practice: 'an alt text on images',
      rule: '@angular-eslint/template/alt-text',
      file: 'apps/web/src/app/fixture.html',
      code: '<img src="a.png" />\n',
    },
    {
      practice: 'keyboard events next to click events',
      rule: '@angular-eslint/template/click-events-have-key-events',
      file: 'apps/web/src/app/fixture.html',
      code: '<div (click)="go()">go</div>\n',
    },
    {
      practice: 'built-in control flow instead of *ngIf',
      rule: '@angular-eslint/template/prefer-control-flow',
      file: 'apps/web/src/app/fixture.html',
      code: '<p *ngIf="ok">yes</p>\n',
    },
    {
      practice: 'no function calls in templates',
      rule: '@angular-eslint/template/no-call-expression',
      file: 'apps/web/src/app/fixture.html',
      code: '<p>{{ compute() }}</p>\n',
    },
  ])('reports $practice', async ({ rule, file, code }) => {
    const messages = await lintFixture(file, code);

    expect(errorsOf(messages, rule).length).toBeGreaterThan(0);
  });

  it('accepts a component that follows the practices', async () => {
    const messages = await lintFixture(
      'apps/web/src/app/fixture.ts',
      `import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'hs-fixture',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixtureComponent {
  readonly name = input('');
}
`,
    );

    expect(messages.filter((m) => m.ruleId?.startsWith('@angular'))).toEqual(
      [],
    );
  });
});
