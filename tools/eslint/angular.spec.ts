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
  ])('reports $practice', async ({ rule, file, code }) => {
    const messages = await lintFixture(file, code);

    expect(errorsOf(messages, rule).length).toBeGreaterThan(0);
  });

  it('does not allow switching an Angular rule off with a comment', async () => {
    const messages = await lintFixture(
      'apps/web/src/app/fixture.ts',
      '// eslint-disable-next-line @angular-eslint/prefer-inject\nexport const a = 1;\n',
    );

    expect(
      errorsOf(
        messages,
        '@eslint-community/eslint-comments/no-restricted-disable',
      ),
    ).toHaveLength(1);
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

// Spec 002 criterion 10: modern Angular only, one fixture per legacy pattern, in a lib of every kind.
const FEATURE = 'libs/web/system/feature/src/lib/fixture.ts';
const UI_TEMPLATE = 'libs/web/system/ui/src/lib/fixture.html';
const onPush = (
  body: string,
  imports = '',
) => `import { ChangeDetectionStrategy, Component${imports} } from '@angular/core';

@Component({
  selector: 'hs-fixture',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FixtureComponent {
${body}}
`;

describe('only modern Angular passes lint', () => {
  it.each([
    {
      pattern: 'an @NgModule',
      rule: 'no-restricted-syntax',
      file: FEATURE,
      code: "import { NgModule } from '@angular/core';\n\n@NgModule({})\nexport class FixtureModule {}\n",
    },
    {
      pattern: 'a component that is not standalone',
      rule: '@angular-eslint/prefer-standalone',
      file: FEATURE,
      code: onPush('').replace(
        "template: '',",
        "template: '',\n  standalone: false,",
      ),
    },
    {
      // OnPush is Angular 22's default, so a component without changeDetection is OnPush; opting out fails.
      pattern: 'a component that opts out of OnPush',
      rule: '@angular-eslint/prefer-on-push-component-change-detection',
      file: FEATURE,
      code: onPush('').replace(
        'ChangeDetectionStrategy.OnPush',
        'ChangeDetectionStrategy.Eager',
      ),
    },
    {
      pattern: '@Input() instead of input()',
      rule: '@angular-eslint/prefer-signals',
      file: FEATURE,
      code: onPush("  @Input() name = '';\n", ', Input'),
    },
    {
      pattern: '@Output() instead of output()',
      rule: '@angular-eslint/prefer-output-emitter-ref',
      file: FEATURE,
      code: onPush(
        '  @Output() readonly changed = new EventEmitter<string>();\n',
        ', EventEmitter, Output',
      ),
    },
    {
      pattern: '@ViewChild() instead of viewChild()',
      rule: '@angular-eslint/prefer-signals',
      file: FEATURE,
      code: onPush(
        "  @ViewChild('ref') ref?: ElementRef;\n",
        ', ElementRef, ViewChild',
      ),
    },
    {
      pattern: '@ContentChild() instead of contentChild()',
      rule: '@angular-eslint/prefer-signals',
      file: FEATURE,
      code: onPush(
        "  @ContentChild('ref') ref?: ElementRef;\n",
        ', ContentChild, ElementRef',
      ),
    },
    {
      pattern: 'constructor injection instead of inject()',
      rule: '@angular-eslint/prefer-inject',
      file: FEATURE,
      code: onPush(
        '  constructor(private readonly element: ElementRef) {}\n',
        ', ElementRef',
      ),
    },
    {
      pattern: 'inline component styles (Stylelint cannot check them)',
      rule: 'no-restricted-syntax',
      file: FEATURE,
      code: onPush('').replace(
        "template: '',",
        "template: '',\n  styles: ':host { color: red; }',",
      ),
    },
    {
      pattern: '*ngIf instead of @if',
      rule: '@angular-eslint/template/prefer-control-flow',
      file: UI_TEMPLATE,
      code: '<p *ngIf="ok">yes</p>\n',
    },
    {
      pattern: '*ngFor instead of @for',
      rule: '@angular-eslint/template/prefer-control-flow',
      file: UI_TEMPLATE,
      code: '<p *ngFor="let item of items">{{ item }}</p>\n',
    },
    {
      pattern: '[ngSwitch] instead of @switch',
      rule: '@angular-eslint/template/prefer-control-flow',
      file: UI_TEMPLATE,
      code: '<div [ngSwitch]="kind"><p *ngSwitchCase="\'a\'">a</p></div>\n',
    },
    {
      pattern: 'a non-self-closing empty component tag',
      rule: '@angular-eslint/template/prefer-self-closing-tags',
      file: UI_TEMPLATE,
      code: '<hs-status-badge [status]="status"></hs-status-badge>\n',
    },
  ])('fails for $pattern', async ({ rule, file, code }) => {
    const messages = await lintFixture(file, code);

    expect(errorsOf(messages, rule).length).toBeGreaterThan(0);
  });

  it('reads signals in templates', async () => {
    const messages = await lintFixture(
      UI_TEMPLATE,
      '@if (status(); as s) {\n  <p>{{ s.label }}</p>\n}\n',
    );

    expect(messages).toEqual([]);
  });
});

// Spec 002 criterion 14: angular-eslint's template accessibility rules.
describe('template accessibility', () => {
  it.each([
    {
      problem: 'an image without alt',
      rule: '@angular-eslint/template/alt-text',
      code: '<img ngSrc="a.png" width="10" height="10" />\n',
    },
    {
      problem: 'a click handler without a key handler',
      rule: '@angular-eslint/template/click-events-have-key-events',
      code: '<span (click)="go()">go</span>\n',
    },
    {
      problem: 'a form control without a label',
      rule: '@angular-eslint/template/label-has-associated-control',
      code: '<label>Name</label>\n<input type="text" />\n',
    },
    {
      problem: 'an interactive element that cannot take focus',
      rule: '@angular-eslint/template/interactive-supports-focus',
      code: '<div role="button" (click)="go()" (keyup.enter)="go()">go</div>\n',
    },
  ])('fails for $problem', async ({ rule, code }) => {
    const messages = await lintFixture(UI_TEMPLATE, code);

    expect(errorsOf(messages, rule).length).toBeGreaterThan(0);
  });
});

describe('switching template rules off', () => {
  it('fails lint for a disable comment in a template', async () => {
    const messages = await lintFixture(
      'libs/web/system/ui/src/lib/fixture.html',
      '<!-- eslint-disable-next-line @angular-eslint/template/no-inline-styles -->\n<p style="color: red">x</p>\n',
    );

    expect(
      errorsOf(
        messages,
        '@eslint-community/eslint-comments/no-restricted-disable',
      ),
    ).toHaveLength(1);
  });
});
