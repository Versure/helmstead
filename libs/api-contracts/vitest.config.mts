import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/api-contracts',
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: 'api-contracts',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // Live tests (*.live.spec.ts) run only with HELMSTEAD_LIVE_TESTS=1 (tools/testing/live-tests.mjs).
    exclude: [
      ...configDefaults.exclude,
      ...(process.env['HELMSTEAD_LIVE_TESTS'] === '1'
        ? []
        : ['**/*.live.spec.ts']),
    ],
    // No test reaches the network (plan §9, spec 003).
    setupFiles: ['../../tools/testing/no-network.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/libs/api-contracts',
      provider: 'v8' as const,
    },
  },
}));
