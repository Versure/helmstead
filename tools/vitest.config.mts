import { defineConfig } from 'vitest/config';

// Tests of the workspace's own guard rails (tag scheme, lint boundaries). They are not an Nx project:
// `node scripts/sdlc/verify.mjs` runs them on every change, because they guard the rules for all projects.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['**/*.spec.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
