import {contextBridge, ipcRenderer} from 'electron';
import * as path from 'path';

interface RequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  rejectUnauthorized?: boolean;
}

interface LcuEventConnectionOptions {
  url: string;
  authorization?: string;
}

type LcuEventCallback = (event: unknown) => void;
type LcuEventStateCallback = (state: {connected: boolean; message: string}) => void;

let eventListener: ((_event: Electron.IpcRendererEvent, payload: unknown) => void) | null = null;
let stateListener: ((_event: Electron.IpcRendererEvent, state: {connected: boolean; message: string}) => void) | null = null;

contextBridge.exposeInMainWorld('leagueProfileTool', {
  request: (options: RequestOptions): Promise<string> => ipcRenderer.invoke('lpt:request', options),
  findLockfile: (targetPaths: string[]): Promise<string> => ipcRenderer.invoke('lpt:find-lockfile', targetPaths),
  readLockfile: (targetPath: string): Promise<string> => ipcRenderer.invoke('lpt:read-lockfile', targetPath),
  readConfiguredClientPath: (): Promise<string> => ipcRenderer.invoke('lpt:read-configured-client-path'),
  findLeagueClientPath: (): Promise<string> => ipcRenderer.invoke('lpt:find-league-client-path'),
  joinPath: (...parts: string[]): string => path.join(...parts),
  dirname: (targetPath: string): string => path.dirname(targetPath),
  openExternal: (targetUrl: string): Promise<void> => ipcRenderer.invoke('lpt:open-external', targetUrl),
  connectLcuEvents: async (
    options: LcuEventConnectionOptions,
    onEvent: LcuEventCallback,
    onState: LcuEventStateCallback
  ): Promise<void> => {
    if (eventListener) ipcRenderer.removeListener('lpt:events-data', eventListener);
    if (stateListener) ipcRenderer.removeListener('lpt:events-state', stateListener);
    eventListener = (_event, payload) => onEvent(payload);
    stateListener = (_event, state) => onState(state);
    ipcRenderer.on('lpt:events-data', eventListener);
    ipcRenderer.on('lpt:events-state', stateListener);
    await ipcRenderer.invoke('lpt:events-connect', options);
  },
  disconnectLcuEvents: (): Promise<void> => ipcRenderer.invoke('lpt:events-disconnect')
});
