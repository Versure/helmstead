import { anyTag, SheriffConfig } from '@softarc/sheriff-core';

/**
 * Sheriff owns the rules inside a project; Nx (`depConstraints` in eslint.config.mjs) owns the rules between projects
 * (docs/adr/004-frontend-architecture.md). Every folder with an index.ts is a module, and a file outside it may
 * import only that index.ts. ESLint runs only Sheriff's deep-import rule, so `depRules` allows every edge: tagging
 * modules here would define the project rules a second time.
 */
export const config: SheriffConfig = {
  autoTagging: true,
  depRules: { '*': anyTag },
};
