import {Injectable} from '@angular/core';

export interface RequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  rejectUnauthorized?: boolean;
}

export interface LcuEventConnectionOptions {
  url: string;
  authorization?: string;
}

export interface LeagueProfileToolBridge {
  request(options: RequestOptions): Promise<string>;
  findLockfile(targetPaths: string[]): Promise<string>;
  readLockfile(targetPath: string): Promise<string>;
  readConfiguredClientPath(): Promise<string>;
  findLeagueClientPath(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  joinPath(...parts: string[]): string;
  dirname(targetPath: string): string;
  openExternal(targetUrl: string): Promise<void>;
  connectLcuEvents(
    options: LcuEventConnectionOptions,
    onEvent: (event: unknown) => void,
    onState: (state: {connected: boolean; message: string}) => void
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

  public findLeagueClientPath(): Promise<string> {
    return this.bridge ? this.bridge.findLeagueClientPath() : Promise.resolve('');
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
    onState: (state: {connected: boolean; message: string}) => void
  ): Promise<void> {
    if (!this.bridge) return Promise.reject(new Error('Electron bridge is unavailable.'));
    return this.bridge.connectLcuEvents(options, onEvent, onState);
  }

  public disconnectLcuEvents(): Promise<void> {
    return this.bridge ? this.bridge.disconnectLcuEvents() : Promise.resolve();
  }
}
