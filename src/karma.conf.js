module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('./karma-edge-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage')
    ],
    client:{
      clearContext: false
    },
    coverageReporter: {
      dir: require('path').join(__dirname, '../coverage'),
      reporters: [
        { type: 'html' },
        { type: 'lcovonly' }
      ]
    },
    reporters: ['progress', 'kjhtml'],
    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    browsers: ['EdgeHeadless']
  });
};
