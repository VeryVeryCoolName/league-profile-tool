import {Injectable} from '@angular/core';

export interface RequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  rejectUnauthorized?: boolean;
  timeoutMs?: number;
}

export interface LcuEventConnectionOptions {
  url: string;
  authorization?: string;
}

export interface LcuEventBridgeState {
  connected: boolean;
  connecting: boolean;
  message: string;
}

export interface ClientInstallInfo {
  path: string;
  label: string;
  running: boolean;
  active: boolean;
}

export interface LeagueProfileToolBridge {
  request(options: RequestOptions): Promise<string>;
  findLockfile(targetPaths: string[]): Promise<string>;
  readLockfile(targetPath: string): Promise<string>;
  readConfiguredClientPath(): Promise<string>;
  listClientPaths(): Promise<ClientInstallInfo[]>;
  setClientPath(clientPath: string): Promise<string>;
  chooseClientPath(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  joinPath(...parts: string[]): string;
  dirname(targetPath: string): string;
  openExternal(targetUrl: string): Promise<void>;
  connectLcuEvents(
    options: LcuEventConnectionOptions,
    onEvent: (event: unknown) => void,
    onState: (state: LcuEventBridgeState) => void
  ): Promise<void>;
  disconnectLcuEvents(): Promise<void>;
}

declare global {
  interface Window {
    leagueProfileTool?: LeagueProfileToolBridge;
  }
}

@Injectable({
  providedIn: 'root'
})
export class ElectronService {
  private readonly bridge = window.leagueProfileTool;

  public readonly shell = this.bridge ? {
    openExternal: (targetUrl: string) => this.bridge.openExternal(targetUrl)
  } : null;

  public get isElectron(): boolean {
    return this.bridge !== undefined;
  }

  public request(options: RequestOptions): Promise<string> {
    if (!this.bridge) return Promise.reject(new Error('Electron bridge is unavailable.'));
    return this.bridge.request(options);
  }

  public findLockfile(targetPaths: string[]): Promise<string> {
    return this.bridge ? this.bridge.findLockfile(targetPaths) : Promise.resolve('');
  }

  public readLockfile(targetPath: string): Promise<string> {
    if (!this.bridge) return Promise.reject(new Error('Electron bridge is unavailable.'));
    return this.bridge.readLockfile(targetPath);
  }

  public readConfiguredClientPath(): Promise<string> {
    return this.bridge ? this.bridge.readConfiguredClientPath() : Promise.resolve('');
  }

  public listClientPaths(): Promise<ClientInstallInfo[]> {
    return this.bridge ? this.bridge.listClientPaths() : Promise.resolve([]);
  }

  public setClientPath(clientPath: string): Promise<string> {
    if (!this.bridge) return Promise.reject(new Error('Electron bridge is unavailable.'));
    return this.bridge.setClientPath(clientPath);
  }

  public chooseClientPath(): Promise<string> {
    return this.bridge ? this.bridge.chooseClientPath() : Promise.resolve('');
  }

  public writeClipboard(text: string): Promise<void> {
    if (this.bridge) return this.bridge.writeClipboard(text);
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    return Promise.reject(new Error('Clipboard access is unavailable.'));
  }

  public joinPath(...parts: string[]): string {
    return this.bridge ? this.bridge.joinPath(...parts) : parts.join('/');
  }

  public dirname(targetPath: string): string {
    return this.bridge ? this.bridge.dirname(targetPath) : '';
  }

  public connectLcuEvents(
    options: LcuEventConnectionOptions,
    onEvent: (event: unknown) => void,
    onState: (state: LcuEventBridgeState) => void
  ): Promise<void> {
    if (!this.bridge) return Promise.reject(new Error('Electron bridge is unavailable.'));
    return this.bridge.connectLcuEvents(options, onEvent, onState);
  }

  public disconnectLcuEvents(): Promise<void> {
    return this.bridge ? this.bridge.disconnectLcuEvents() : Promise.resolve();
  }
}
