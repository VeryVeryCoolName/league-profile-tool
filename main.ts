import {app, BrowserWindow, clipboard, dialog, ipcMain, shell} from 'electron';
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
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const MAX_EVENT_BUFFER_BYTES = 8 * 1024 * 1024;
const SCRIPT_SRC_POLICY = serve ? "script-src 'self' 'unsafe-eval'" : "script-src 'self'";
const CONNECT_SRC_POLICY = serve
  ? "connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://ddragon.leagueoflegends.com https://raw.communitydragon.org http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*"
  : "connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://ddragon.leagueoflegends.com https://raw.communitydragon.org";
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  SCRIPT_SRC_POLICY,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://ddragon.leagueoflegends.com https://raw.communitydragon.org",
  CONNECT_SRC_POLICY,
  "font-src 'self' data:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'"
].join('; ');
const ALLOWED_LCU_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_LCU_HEADERS = new Set(['accept', 'authorization', 'content-type']);
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'lolalytics.com',
  'www.lolalytics.com'
]);

let win: BrowserWindow | null = null;
let eventSocket: LcuEventSocket | null = null;

function firstExistingPath(paths: string[]): string {
  return paths.find(candidate => fs.existsSync(candidate)) || paths[0];
}

function appIconPath(): string {
  return firstExistingPath([
    path.join(__dirname, 'dist', 'assets', 'icon.ico'),
    path.join(__dirname, 'src', 'assets', 'icon.ico'),
    path.join(process.resourcesPath || __dirname, 'assets', 'icon.ico')
  ]);
}

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
    const hostname = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return (target.protocol === 'http:' || target.protocol === 'https:')
      && ['127.0.0.1', 'localhost', '::1'].includes(hostname);
  } catch {
    return false;
  }
}

function isValidTcpPort(value: string): boolean {
  if (!/^\d{1,5}$/.test(value)) return false;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function isSafeHeaderValue(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 8192
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function sanitizeLcuHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};

  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = String(name || '').trim().toLowerCase();
    if (!ALLOWED_LCU_HEADERS.has(normalizedName) || !isSafeHeaderValue(value)) continue;

    if (normalizedName === 'accept') output.Accept = value;
    if (normalizedName === 'authorization') output.Authorization = value;
    if (normalizedName === 'content-type') output['Content-Type'] = value;
  }
  return output;
}

function isAllowedLcuPath(pathname: string): boolean {
  return pathname === '/help'
    || pathname.startsWith('/lol-')
    || pathname.startsWith('/plugin-manager/')
    || pathname.startsWith('/riotclient/');
}

function hasUnsafeLcuPathEncoding(pathname: string): boolean {
  return /[\u0000-\u001f\u007f\\]/.test(pathname) || /%(?:2e|2f|5c)/i.test(pathname);
}

function normalizeRequestMethod(value: string | undefined): string {
  return String(value || 'GET').trim().toUpperCase();
}

function headerValue(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return '';
  const key = Object.keys(headers).find(item => item.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key] || '') : '';
}

function hasLcuAuthorization(headers: Record<string, string> | undefined): boolean {
  const authorization = headerValue(headers, 'authorization');
  const match = /^Basic\s+(.+)$/i.exec(authorization);
  if (!match) return false;

  try {
    return Buffer.from(match[1], 'base64').toString('utf8').startsWith('riot:');
  } catch {
    return false;
  }
}

function isAllowedExternalUrl(value: string): boolean {
  try {
    const target = new URL(value);
    return target.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(target.hostname.toLowerCase());
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
    if (!isValidTcpPort(target.port)) {
      reject(new Error('LCU request port is invalid.'));
      return;
    }
    const method = normalizeRequestMethod(options.method);
    if (!ALLOWED_LCU_METHODS.has(method)) {
      reject(new Error('Unsupported LCU request method.'));
      return;
    }
    if (!isAllowedLcuPath(target.pathname) || hasUnsafeLcuPathEncoding(target.pathname)) {
      reject(new Error('Unsupported LCU request path.'));
      return;
    }
    if (!hasLcuAuthorization(options.headers)) {
      reject(new Error('LCU authorization is required.'));
      return;
    }
    if (options.body !== undefined && typeof options.body !== 'string') {
      reject(new Error('LCU request body is invalid.'));
      return;
    }
    if (options.body && Buffer.byteLength(options.body, 'utf8') > MAX_REQUEST_BODY_BYTES) {
      reject(new Error('LCU request body exceeded the supported size limit.'));
      return;
    }

    const transport = target.protocol === 'http:' ? http : https;
    const headers = sanitizeLcuHeaders(options.headers);
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
      method,
      headers,
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
    if (method !== 'GET' && options.body) request.write(options.body);
    request.end();
  });
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
    }
  }
  return '';
}

function savedClientPathFile(): string {
  return path.join(app.getPath('userData'), 'clientPath.txt');
}

function writableConfigClientPathFile(): string {
  return path.join(process.cwd(), 'config', 'clientPath.txt');
}

function readSavedClientPath(): string {
  try {
    return fs.readFileSync(savedClientPathFile(), 'utf8').trim();
  } catch {
    return '';
  }
}

function readKnownClientPath(): string {
  return readConfiguredClientPath() || readSavedClientPath();
}

function normalizeClientPath(clientPath: string): string {
  const normalized = String(clientPath || '').trim().replace(/^"|"$/g, '');
  if (!normalized) return '';
  if (normalized.toLowerCase().endsWith('.exe')) return path.dirname(normalized);
  return normalized;
}

function commonLeagueInstallPaths(): string[] {
  return [
    'C:\\Riot Games\\League of Legends',
    'D:\\Riot Games\\League of Legends',
    'F:\\Riot Games\\League of Legends',
    'C:\\Program Files\\Riot Games\\League of Legends',
    'C:\\Program Files (x86)\\Riot Games\\League of Legends'
  ];
}

function normalizedPathKey(targetPath: string): string {
  try {
    return path.resolve(targetPath).toLowerCase();
  } catch {
    return '';
  }
}

function isLeagueClientDirectory(clientPath: string): boolean {
  try {
    const normalized = normalizeClientPath(clientPath);
    return normalized.length > 0
      && normalized.length < 4096
      && (
        fs.existsSync(path.join(normalized, 'LeagueClient.exe'))
        || fs.existsSync(path.join(normalized, 'LeagueClientUx.exe'))
        || fs.existsSync(path.join(normalized, 'lockfile'))
      );
  } catch {
    return false;
  }
}

function writeSavedClientPath(clientPath: string): string {
  const normalized = normalizeClientPath(clientPath);
  if (!isLeagueClientDirectory(normalized)) {
    throw new Error('Selected folder does not look like a League of Legends install.');
  }

  fs.mkdirSync(path.dirname(savedClientPathFile()), {recursive: true});
  fs.writeFileSync(savedClientPathFile(), normalized, 'utf8');
  try {
    const configPath = writableConfigClientPathFile();
    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    fs.writeFileSync(configPath, normalized, 'utf8');
  } catch {
  }
  return normalized;
}

function allowedClientPathKeys(): Set<string> {
  const paths = [readConfiguredClientPath(), readSavedClientPath(), ...commonLeagueInstallPaths()]
    .map(candidate => normalizeClientPath(candidate))
    .filter(Boolean)
    .map(candidate => normalizedPathKey(candidate))
    .filter(Boolean);
  return new Set(paths);
}

function isLockfilePath(targetPath: string): boolean {
  return typeof targetPath === 'string'
    && targetPath.length < 4096
    && path.basename(targetPath).toLowerCase() === 'lockfile';
}

function isAllowedLockfilePath(targetPath: string): boolean {
  if (!isLockfilePath(targetPath)) return false;
  const parentPath = normalizedPathKey(path.dirname(targetPath));
  return !!parentPath && allowedClientPathKeys().has(parentPath);
}

function registerIpcHandlers(): void {
  ipcMain.handle('lpt:request', (_event, options: RequestOptions) => makeRequest(options));
  ipcMain.handle('lpt:find-lockfile', (_event, targetPaths: string[]) => {
    if (!Array.isArray(targetPaths) || targetPaths.length > 32) return '';
    return targetPaths.find(targetPath => {
      return isAllowedLockfilePath(targetPath) && fs.existsSync(targetPath);
    }) || '';
  });
  ipcMain.handle('lpt:read-lockfile', (_event, targetPath: string) => {
    if (!isAllowedLockfilePath(targetPath)) throw new Error('Invalid lockfile path.');
    if (fs.statSync(targetPath).size > 2048) throw new Error('Invalid lockfile size.');
    return fs.readFileSync(targetPath, 'utf8');
  });
  ipcMain.handle('lpt:read-configured-client-path', () => readKnownClientPath());
  ipcMain.handle('lpt:choose-client-path', async () => {
    if (!win) return '';

    const result = await dialog.showOpenDialog(win, {
      title: 'Select League of Legends folder',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return '';

    return writeSavedClientPath(result.filePaths[0]);
  });
  ipcMain.handle('lpt:write-clipboard', (_event, text: string) => {
    if (typeof text !== 'string' || text.length > MAX_RESPONSE_BYTES) {
      throw new Error('Invalid clipboard content.');
    }
    clipboard.writeText(text);
  });
  ipcMain.handle('lpt:open-external', (_event, targetUrl: string) => {
    if (!isAllowedExternalUrl(targetUrl)) {
      throw new Error('Unsupported external URL.');
    }
    const target = new URL(targetUrl);
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
    icon: appIconPath()
  });

  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-attach-webview', event => {
    event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
        'X-Content-Type-Options': ['nosniff'],
        'Referrer-Policy': ['no-referrer']
      }
    });
  });
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
    if (!hasLcuAuthorization({Authorization: this.options.authorization || ''})) {
      this.finish('LCU event authorization is required.');
      return;
    }

    try {
      const target = new URL(this.options.url);
      if (target.protocol !== 'https:' || !isValidTcpPort(target.port)) {
        this.finish('Invalid LCU event endpoint.');
        return;
      }
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

void app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
