import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';
import { angularFileNames } from './angular-file-names.mjs';

// The owner's naming convention (PR #3): a file says what it holds, `*.component.ts`, `*.directive.ts`, `*.pipe.ts`,
// `*.service.ts`, and the class name says it too.
RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
});

const component = (
  className: string,
  extra = "templateUrl: './status-badge.component.html',\n  styleUrl: './status-badge.component.css',",
) => `import { Component } from '@angular/core';

@Component({
  selector: 'hs-status-badge',
  ${extra}
})
export class ${className} {}
`;

tester.run('angular-file-names', angularFileNames, {
  valid: [
    {
      name: 'a component in *.component.ts with matching template and styles',
      filename:
        '/repo/libs/web/system/ui/src/lib/status-badge/status-badge.component.ts',
      code: component('StatusBadgeComponent'),
    },
    {
      name: 'a component with an inline template and styleUrls',
      filename:
        '/repo/libs/web/system/ui/src/lib/status-badge/status-badge.component.ts',
      code: component(
        'StatusBadgeComponent',
        "template: '',\n  styleUrls: ['./status-badge.component.css'],",
      ),
    },
    {
      name: 'a service in *.service.ts',
      filename:
        '/repo/libs/web/system/data-access/src/lib/system-status.service.ts',
      code: "import { Injectable } from '@angular/core';\n\n@Injectable({ providedIn: 'root' })\nexport class SystemStatusService {}\n",
    },
    {
      name: 'a directive in *.directive.ts',
      filename: '/repo/libs/ui/src/lib/focus-ring/focus-ring.directive.ts',
      code: "import { Directive } from '@angular/core';\n\n@Directive({ selector: '[hsFocusRing]' })\nexport class FocusRingDirective {}\n",
    },
    {
      name: 'a pipe in *.pipe.ts',
      filename: '/repo/libs/ui/src/lib/relative-time/relative-time.pipe.ts',
      code: "import { Pipe } from '@angular/core';\n\n@Pipe({ name: 'relativeTime' })\nexport class RelativeTimePipe {}\n",
    },
    {
      name: 'the root component in src/app',
      filename: '/repo/apps/web/src/app/app.component.ts',
      code: "import { Component } from '@angular/core';\n\n@Component({ selector: 'hs-root', templateUrl: './app.component.html' })\nexport class AppComponent {}\n",
    },
    {
      name: 'a plain module of functions and types',
      filename: '/repo/libs/web/system/data-access/src/lib/core-base-url.ts',
      code: "export const CORE_BASE_URL = 'x';\n",
    },
    {
      name: 'a test host component inside a spec file',
      filename:
        '/repo/libs/web/system/ui/src/lib/status-badge/status-badge.component.spec.ts',
      code: "import { Component } from '@angular/core';\n\n@Component({ template: '' })\nclass Host {}\n",
    },
  ],
  invalid: [
    {
      name: 'a component that is not in a folder of its own',
      filename:
        '/repo/libs/web/system/feature/src/lib/system-status.component.ts',
      code: component('SystemStatusComponent', "template: '',"),
      errors: [{ messageId: 'folder' }],
    },
    {
      name: 'a component in a folder with another name',
      filename:
        '/repo/libs/web/system/ui/src/lib/badges/status-badge.component.ts',
      code: component('StatusBadgeComponent'),
      errors: [{ messageId: 'folder' }],
    },
    {
      name: 'a directive that is not in a folder of its own',
      filename: '/repo/libs/ui/src/lib/focus-ring.directive.ts',
      code: "import { Directive } from '@angular/core';\n\n@Directive({ selector: '[hsFocusRing]' })\nexport class FocusRingDirective {}\n",
      errors: [{ messageId: 'folder' }],
    },
    {
      name: 'a component in a file without .component',
      filename: '/repo/libs/web/system/ui/src/lib/status-badge.ts',
      code: component('StatusBadgeComponent'),
      errors: [{ messageId: 'fileName' }],
    },
    {
      name: 'a component class without the Component suffix',
      filename:
        '/repo/libs/web/system/ui/src/lib/status-badge/status-badge.component.ts',
      code: component('StatusBadge'),
      errors: [{ messageId: 'className' }],
    },
    {
      name: 'a template that does not match the component file',
      filename:
        '/repo/libs/web/system/ui/src/lib/status-badge/status-badge.component.ts',
      code: component(
        'StatusBadgeComponent',
        "templateUrl: './status-badge.html',\n  styleUrl: './status-badge.component.css',",
      ),
      errors: [{ messageId: 'resource' }],
    },
    {
      name: 'styles that do not match the component file',
      filename:
        '/repo/libs/web/system/ui/src/lib/status-badge/status-badge.component.ts',
      code: component(
        'StatusBadgeComponent',
        "template: '',\n  styleUrls: ['./badge.css'],",
      ),
      errors: [{ messageId: 'resource' }],
    },
    {
      name: 'a service in a file without .service',
      filename: '/repo/libs/web/system/data-access/src/lib/system-status.ts',
      code: "import { Injectable } from '@angular/core';\n\n@Injectable({ providedIn: 'root' })\nexport class SystemStatusService {}\n",
      errors: [{ messageId: 'fileName' }],
    },
    {
      name: 'a service class without the Service suffix',
      filename:
        '/repo/libs/web/system/data-access/src/lib/system-status.service.ts',
      code: "import { Injectable } from '@angular/core';\n\n@Injectable({ providedIn: 'root' })\nexport class SystemStatus {}\n",
      errors: [{ messageId: 'className' }],
    },
    {
      name: 'a directive in a file without .directive',
      filename: '/repo/libs/ui/src/lib/focus-ring.ts',
      code: "import { Directive } from '@angular/core';\n\n@Directive({ selector: '[hsFocusRing]' })\nexport class FocusRingDirective {}\n",
      errors: [{ messageId: 'fileName' }],
    },
    {
      name: 'a pipe class without the Pipe suffix, in a file without .pipe',
      filename: '/repo/libs/ui/src/lib/relative-time.ts',
      code: "import { Pipe } from '@angular/core';\n\n@Pipe({ name: 'relativeTime' })\nexport class RelativeTime {}\n",
      errors: [{ messageId: 'fileName' }, { messageId: 'className' }],
    },
  ],
});
