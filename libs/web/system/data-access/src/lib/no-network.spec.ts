// The network guard (tools/testing/no-network.ts) is a setup file of every Angular test target (spec 003). This
// proves it is active in the Angular builder's test run, not only configured: a request to TEST-NET-1, which is
// never routed, fails with the guard's error before any connection is attempted.
describe('tests in an Angular project', () => {
  it('cannot reach a non-loopback host', () => {
    expect(() => fetch('http://192.0.2.1/')).toThrow(/is blocked in tests/);
  });
});
