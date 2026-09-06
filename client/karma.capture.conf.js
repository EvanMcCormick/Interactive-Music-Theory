// Karma configuration for the harmonic capture spec, and nothing else.
//
// `harmonic-capture.spec.ts` is excluded from the default suite by an
// `exclude` glob on the `test` target in angular.json, because it drives the
// real detector: ten materials, each a WebGL inference run, inside a single
// `it`. Karma's `browserNoActivityTimeout` is 30 s and a browser that spends
// longer than that in one spec is indistinguishable from a dead one, so
// including it in `npm test` ended the run at
// `Executed 448 of 559 DISCONNECTED` and took every later spec's result with
// it. It is reached instead through the `capture` configuration:
//
//     npm test -- --configuration=capture --watch=false
//
// The only thing this file changes is that budget. On a warm machine the
// capture takes about 20 s and each `CAPTURE` line it prints refreshes the
// timer - but nothing is printed until the first material has loaded the model
// and compiled its shaders, and the spec's own jasmine timeout is 600 s, which
// karma would have no way to honour at 30. So the budget is raised to match
// the spec rather than left to sit a few seconds under it.
//
// A separate file rather than raising the timeout globally: 30 s is a useful
// alarm on every other spec in the suite, and a hang there should fail rather
// than sit for ten minutes.
const base = require('./karma.conf');

module.exports = function (config) {
  base(config);
  config.set({
    browserNoActivityTimeout: 600000
  });
};
