// Tests that really need a live API are named *.live.spec.ts (spec 003 criterion 16). No normal run includes them;
// they run only with HELMSTEAD_LIVE_TESTS=1, which also lifts the network guard (tools/testing/no-network.ts).
// No workflow sets that variable (tools/workspace/no-network.spec.ts checks it).
export const LIVE_TEST_GLOB = '**/*.live.spec.ts';

export const liveTestsEnabled = (env = process.env) =>
  env.HELMSTEAD_LIVE_TESTS === '1';

/** The exclude entries for a Vitest config: the live tests, unless HELMSTEAD_LIVE_TESTS=1. */
export const liveTestExclude = (env = process.env) =>
  liveTestsEnabled(env) ? [] : [LIVE_TEST_GLOB];
