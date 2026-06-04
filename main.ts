import {app, BrowserWindow, globalShortcut} from 'electron';
import * as path from 'path';
import * as url from 'url';

const versionInfo = require('./version.json');
const appVersion = normalizeVersion(versionInfo.version);
const appTitleVersion = shortVersion(appVersion);
const appTitle = appTitleVersion ? `League Profile Tool ${appTitleVersion}` : 'League Profile Tool';

let win: BrowserWindow = null;
const args = process.argv.slice(1),
  serve = args.some(val => val === '--serve');

function normalizeVersion(value: string): string {
  const match = /(\d+(?:\.\d+){0,2})/.exec(String(value || ''));
  if (!match) return '';

  const parts = match[1].split('.');
  while (parts.length < 3) parts.push('0');
  return parts.slice(0, 3).join('.');
}

function shortVersion(version: string): string {
  const normalized = normalizeVersion(version);
  return normalized ? normalized.split('.').slice(0, 2).join('.') : '';
}

function createWindow(): BrowserWindow {

  // Create the browser window.
  win = new BrowserWindow({
    title: appTitle,
    width: 950,
    height: 650,
    backgroundColor: '#2b2b2d',
    webPreferences: {
      nodeIntegration: true,
      allowRunningInsecureContent: (serve),
      contextIsolation: false,  // false if you want to run 2e2 test with Spectron
      enableRemoteModule: false,
      devTools: false
    },
    autoHideMenuBar: true,
    icon: path.join(__dirname, '/dist/assets/icon.ico')
  });

  win.loadURL(url.format({
    pathname: path.join(__dirname, 'dist/index.html'),
    protocol: 'file:',
    slashes: true
  }));

  // Emitted when the window is closed.
  win.on('closed', () => {
    // Dereference the window object, usually you would store window
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null;
  });

  return win;
}

app.on("ready", createWindow);

// Disable refresh
app.whenReady().then(() => {
  globalShortcut.register("CommandOrControl+R", () => {
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// Quit when all windows are closed.
app.on("window-all-closed", () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
