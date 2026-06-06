import {app, BrowserWindow, clipboard, ipcMain, shell} from 'electron';
import * as childProcess from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as tls from 'tls';
import * as url from 'url';

interface RequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  rejectUnauthorized?: boolean;
}

interface EventConnectionOptions {
  url: string;
  authorization?: string;
}

const versionInfo = require('./version.json');
const appVersion = normalizeVersion(versionInfo.version);
const appTitleVersion = shortVersion(appVersion);
const appTitle = appTitleVersion ? `League Profile Tool ${appTitleVersion}` : 'League Profile Tool';
const serve = process.argv.slice(1).some(value => value === '--serve');
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_EVENT_BUFFER_BYTES = 8 * 1024 * 1024;

let win: BrowserWindow | null = null;
let eventSocket: LcuEventSocket | null = null;

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

function isLoopbackUrl(value: string): boolean {
  try {
    const target = new URL(value);
    return (target.protocol === 'http:' || target.protocol === 'https:')
      && ['127.0.0.1', 'localhost', '::1'].includes(target.hostname);
  } catch {
    return false;
  }
}

function makeRequest(options: RequestOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!options || !isLoopbackUrl(options.url)) {
      reject(new Error('Only local LCU requests are allowed.'));
      return;
    }

    const target = new URL(options.url);
    const transport = target.protocol === 'http:' ? http : https;
    let settled = false;
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method || 'GET',
      headers: {...(options.headers || {})},
      rejectUnauthorized: options.rejectUnauthorized !== false
    }, response => {
      let body = '';
      let responseBytes = 0;
      response.setEncoding('utf8');
      response.on('data', chunk => {
        responseBytes += Buffer.byteLength(chunk, 'utf8');
        if (responseBytes > MAX_RESPONSE_BYTES) {
          const error = new Error('LCU response exceeded the supported size limit.');
          response.destroy(error);
          rejectOnce(error);
          return;
        }
        body += chunk;
      });
      response.once('error', rejectOnce);
      response.on('end', () => {
        if (settled) return;
        const statusCode = response.statusCode || 0;
        if (statusCode >= 200 && statusCode < 300) {
          settled = true;
          resolve(body);
          return;
        }
        rejectOnce(new Error(`${statusCode} ${String(response.statusMessage || '')}: ${body}`));
      });
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('LCU request timed out.'));
    });
    request.once('error', rejectOnce);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function findLeagueClientPath(): string {
  const commands = [
    '(Get-Process LeagueClientUx -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)',
    '(Get-CimInstance Win32_Process -Filter "name = \'LeagueClientUx.exe\'" | Select-Object -First 1 -ExpandProperty CommandLine)'
  ];

  for (const command of commands) {
    try {
      const output = childProcess.execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        {encoding: 'utf8', windowsHide: true, timeout: 5000}
      ).trim();
      if (!output) continue;
      if (output.toLowerCase().endsWith('.exe')) return path.dirname(output);

      const match = /--install-directory=(?:"([^"]+)"|([^ ]+))/.exec(output);
      if (match) return match[1] || match[2];
    } catch {
      // League is either closed or not discoverable through this method.
    }
  }
  return '';
}

function readConfiguredClientPath(): string {
  const candidates = [
    path.join(process.cwd(), 'config', 'clientPath.txt'),
    path.join(app.getAppPath(), 'config', 'clientPath.txt'),
    path.join(process.resourcesPath, 'config', 'clientPath.txt')
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8').trim();
    } catch {
      // Try the next supported config location.
    }
  }
  return '';
}

function isLockfilePath(targetPath: string): boolean {
  return typeof targetPath === 'string'
    && targetPath.length < 4096
    && path.basename(targetPath).toLowerCase() === 'lockfile';
}

function registerIpcHandlers(): void {
  ipcMain.handle('lpt:request', (_event, options: RequestOptions) => makeRequest(options));
  ipcMain.handle('lpt:find-lockfile', (_event, targetPaths: string[]) => {
    if (!Array.isArray(targetPaths) || targetPaths.length > 32) return '';
    return targetPaths.find(targetPath => {
      return isLockfilePath(targetPath) && fs.existsSync(targetPath);
    }) || '';
  });
  ipcMain.handle('lpt:read-lockfile', (_event, targetPath: string) => {
    if (!isLockfilePath(targetPath)) throw new Error('Invalid lockfile path.');
    if (fs.statSync(targetPath).size > 2048) throw new Error('Invalid lockfile size.');
    return fs.readFileSync(targetPath, 'utf8');
  });
  ipcMain.handle('lpt:read-configured-client-path', () => readConfiguredClientPath());
  ipcMain.handle('lpt:find-league-client-path', () => findLeagueClientPath());
  ipcMain.handle('lpt:write-clipboard', (_event, text: string) => {
    if (typeof text !== 'string' || text.length > MAX_RESPONSE_BYTES) {
      throw new Error('Invalid clipboard content.');
    }
    clipboard.writeText(text);
  });
  ipcMain.handle('lpt:open-external', (_event, targetUrl: string) => {
    const target = new URL(targetUrl);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      throw new Error('Unsupported external URL.');
    }
    return shell.openExternal(target.toString());
  });
  ipcMain.handle('lpt:events-connect', (event, options: EventConnectionOptions) => {
    eventSocket?.close();
    const sender = event.sender;
    eventSocket = new LcuEventSocket(
      options,
      payload => {
        if (!sender.isDestroyed()) sender.send('lpt:events-data', payload);
      },
      state => {
        if (!sender.isDestroyed()) sender.send('lpt:events-state', state);
      }
    );
    eventSocket.connect();
  });
  ipcMain.handle('lpt:events-disconnect', () => {
    eventSocket?.close();
    eventSocket = null;
  });
}

function createWindow(): BrowserWindow {
  win = new BrowserWindow({
    title: appTitle,
    width: 950,
    height: 650,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#2b2b2d',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: serve
    },
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'dist', 'assets', 'icon.ico')
  });

  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', event => {
    event.preventDefault();
  });
  win.webContents.on('before-input-event', (event, input) => {
    const refresh = input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r');
    if (refresh) event.preventDefault();
  });
  win.once('ready-to-show', () => win?.show());

  if (serve) {
    void win.loadURL('http://localhost:4200');
  } else {
    void win.loadURL(url.format({
      pathname: path.join(__dirname, 'dist', 'index.html'),
      protocol: 'file:',
      slashes: true
    }));
  }

  win.on('closed', () => {
    eventSocket?.close();
    eventSocket = null;
    win = null;
  });

  return win;
}

class LcuEventSocket {
  private socket: tls.TLSSocket | null = null;
  private frameBuffer = Buffer.alloc(0);
  private handshakeBuffer = Buffer.alloc(0);
  private handshakeComplete = false;
  private closed = false;

  constructor(
    private readonly options: EventConnectionOptions,
    private readonly emitEvent: (event: unknown) => void,
    private readonly emitState: (state: {connected: boolean; message: string}) => void
  ) {
  }

  connect(): void {
    if (!this.options || !isLoopbackUrl(this.options.url)) {
      this.finish('Invalid LCU event URL.');
      return;
    }

    try {
      const target = new URL(this.options.url);
      this.emitState({connected: false, message: 'Connecting to LCU events'});
      this.socket = tls.connect({
        host: target.hostname,
        port: Number(target.port),
        rejectUnauthorized: false
      });
      this.socket.once('secureConnect', () => this.sendHandshake(target));
      this.socket.on('data', chunk => this.receiveData(chunk));
      this.socket.once('error', error => this.finish(`Event socket error: ${error.message}`));
      this.socket.once('end', () => this.finish('Event socket ended'));
      this.socket.once('close', () => this.finish('Event socket closed'));
    } catch (error) {
      this.finish(`Could not connect event socket: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.socket) {
      this.socket.removeAllListeners();
      if (!this.socket.destroyed) this.socket.destroy();
      this.socket = null;
    }
  }

  private sendHandshake(target: URL): void {
    if (!this.socket) return;
    const key = crypto.randomBytes(16).toString('base64');
    const lines = [
      'GET / HTTP/1.1',
      `Host: ${target.hostname}:${target.port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      this.options.authorization ? `Authorization: ${this.options.authorization}` : ''
    ].filter(Boolean);
    this.socket.write(`${lines.join('\r\n')}\r\n\r\n`);
  }

  private receiveData(chunk: Buffer): void {
    if (!this.handshakeComplete) {
      this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, chunk]);
      if (this.handshakeBuffer.length > MAX_EVENT_BUFFER_BYTES) {
        this.finish('LCU event handshake exceeded the supported size limit');
        return;
      }
      const marker = this.handshakeBuffer.indexOf('\r\n\r\n');
      if (marker < 0) return;

      const header = this.handshakeBuffer.subarray(0, marker).toString('utf8');
      const remaining = this.handshakeBuffer.subarray(marker + 4);
      if (!/^HTTP\/1\.[01] 101\b/m.test(header)) {
        this.finish('LCU event socket handshake rejected');
        return;
      }
      this.handshakeComplete = true;
      this.emitState({connected: true, message: 'LCU events connected'});
      this.sendFrame(Buffer.from(JSON.stringify([5, 'OnJsonApiEvent']), 'utf8'), 1);
      if (remaining.length > 0) this.receiveFrames(remaining);
      return;
    }
    this.receiveFrames(chunk);
  }

  private receiveFrames(chunk: Buffer): void {
    this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);
    if (this.frameBuffer.length > MAX_EVENT_BUFFER_BYTES) {
      this.finish('LCU event payload exceeded the supported size limit');
      return;
    }
    while (this.frameBuffer.length >= 2) {
      const first = this.frameBuffer[0];
      const second = this.frameBuffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) === 0x80;
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.frameBuffer.length < offset + 2) return;
        length = this.frameBuffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.frameBuffer.length < offset + 8) return;
        const high = this.frameBuffer.readUInt32BE(offset);
        const low = this.frameBuffer.readUInt32BE(offset + 4);
        length = high * 4294967296 + low;
        offset += 8;
      }

      if (!Number.isSafeInteger(length) || length > MAX_EVENT_BUFFER_BYTES) {
        this.finish('LCU event frame exceeded the supported size limit');
        return;
      }

      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.frameBuffer.length < offset + length) return;

      const mask = masked ? this.frameBuffer.subarray(maskOffset, maskOffset + 4) : null;
      let payload: Buffer = this.frameBuffer.subarray(offset, offset + length);
      this.frameBuffer = this.frameBuffer.subarray(offset + length);
      if (masked && mask) payload = this.applyMask(payload, mask);

      if (opcode === 1) this.handleText(payload.toString('utf8'));
      if (opcode === 8) {
        this.finish('LCU event socket closed by server');
        return;
      }
      if (opcode === 9) this.sendFrame(payload, 10);
    }
  }

  private handleText(text: string): void {
    try {
      const message = JSON.parse(text);
      if (Array.isArray(message) && message.length >= 3 && message[2]) {
        this.emitEvent(message[2]);
      }
    } catch {
      // Ignore malformed/non-JSON event frames.
    }
  }

  private sendFrame(payload: Buffer, opcode: number): void {
    if (!this.socket || this.socket.destroyed) return;
    const mask = crypto.randomBytes(4);
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(payload.length, 6);
    }
    this.socket.write(Buffer.concat([header, mask, this.applyMask(payload, mask)]));
  }

  private applyMask(payload: Buffer, mask: Buffer): Buffer {
    const output = Buffer.alloc(payload.length);
    for (let index = 0; index < payload.length; index++) {
      output[index] = payload[index] ^ mask[index % 4];
    }
    return output;
  }

  private finish(message: string): void {
    if (this.closed) return;
    this.close();
    this.emitState({connected: false, message});
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  void app.whenReady().then(() => {
    registerIpcHandlers();
    createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
