const fs = require('fs');

const edgePaths = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

function EdgeHeadlessBrowser(baseBrowserDecorator) {
  baseBrowserDecorator(this);

  this._getOptions = function (url) {
    return [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--in-process-gpu',
      '--disable-software-rasterizer',
      '--disable-gpu-compositing',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      `--user-data-dir=${this._tempDir}`,
      url
    ];
  };
}

EdgeHeadlessBrowser.prototype = {
  name: 'EdgeHeadless',
  DEFAULT_CMD: {
    win32: edgePaths.find(candidate => fs.existsSync(candidate))
  },
  ENV_CMD: 'EDGE_BIN'
};

EdgeHeadlessBrowser.$inject = ['baseBrowserDecorator'];

module.exports = {
  'launcher:EdgeHeadless': ['type', EdgeHeadlessBrowser]
};
