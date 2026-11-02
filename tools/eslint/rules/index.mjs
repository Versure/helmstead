import { angularFileNames } from './angular-file-names.mjs';
import { contractTypes } from './contract-types.mjs';

/** Helmstead's own ESLint rules (docs/adr/004-frontend-architecture.md). */
export default {
  meta: { name: 'helmstead' },
  rules: {
    'angular-file-names': angularFileNames,
    'contract-types': contractTypes,
  },
};
