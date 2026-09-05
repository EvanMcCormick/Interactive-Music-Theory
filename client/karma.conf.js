// Karma configuration for the MusicTheory client.
// Run with: npm test  (add -- --watch=false for a single CI-style run)
module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
      require('@angular-devkit/build-angular/plugins/karma')
    ],
    client: {
      jasmine: {
        // Keep declaration order so failures are easier to locate.
        random: false
      },
      clearContext: false
    },
    jasmineHtmlReporter: {
      suppressAll: true
    },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }]
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['ChromeHeadless'],
    customLaunchers: {
      // Deliberately shadows karma-chrome-launcher's own ChromeHeadless.
      //
      // The stock one passes --disable-gpu and so has no WebGL at all, and
      // TF.js reacts to a missing GL context by quietly falling back to its
      // CPU backend. The note detector runs on WebGL in production, and the
      // whole reason `BasicPitchDetector` reimplements Basic Pitch's inference
      // loop is WebGL tensor readback; on the CPU backend that spec would pass
      // while never touching the code path it exists to cover. SwiftShader is
      // a software rasteriser, so this buys coverage rather than speed - the
      // detector spec takes 3.1 s under it against 2.6 s on CPU.
      //
      // Shadowing the name rather than adding a second launcher is what makes
      // `--browsers=ChromeHeadless`, which is how everything from the plans to
      // CI invokes this, get the GL-capable browser too.
      ChromeHeadless: {
        base: 'Chrome',
        flags: [
          '--headless=new',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--remote-debugging-port=9222',
          '--use-gl=angle',
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader'
        ]
      }
      // There was a `ChromeHeadlessNoSandbox` here and it was a trap. Nothing
      // referenced it, and because the launcher above shadows the stock
      // `ChromeHeadless` it inherited the SwiftShader flags while still adding
      // `--disable-gpu` - so any CI reaching for it by name would have got the
      // CPU backend and failed the `backend === 'webgl'` assertion, on a
      // launcher that existed only to be safe. `--no-sandbox` is already in
      // the launcher above, which is what containers need it for.
    },
    restartOnFileChange: true
  });
};
