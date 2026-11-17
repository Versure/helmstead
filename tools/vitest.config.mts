import { configDefaults, defineConfig } from 'vitest/config';
import { liveTestExclude } from './testing/live-tests.mjs';

// Tests of the workspace's own guard rails (tag scheme, lint boundaries, supply chain, network ban). They are not an
// Nx project: `node scripts/sdlc/verify.mjs` runs them on every change, because they guard the rules for all projects.
export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['**/*.spec.ts'],
    exclude: [...configDefaults.exclude, ...liveTestExclude()],
    // No test reaches the network (plan §9, spec 003).
    setupFiles: ['./testing/no-network.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
