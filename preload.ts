import {contextBridge, ipcRenderer} from 'electron';

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

function clearLcuEventListeners(): void {
  if (eventListener) ipcRenderer.removeListener('lpt:events-data', eventListener);
  if (stateListener) ipcRenderer.removeListener('lpt:events-state', stateListener);
  eventListener = null;
  stateListener = null;
}

function joinPathParts(...parts: string[]): string {
  const values = parts.map(part => String(part || '')).filter(Boolean);
  if (values.length === 0) return '';

  const separator = values[0].includes('\\') ? '\\' : '/';
  return values
    .map((part, index) => {
      if (index === 0) return part.replace(/[\\/]+$/g, '');
      return part.replace(/^[\\/]+|[\\/]+$/g, '');
    })
    .filter(Boolean)
    .join(separator);
}

function parentPath(targetPath: string): string {
  const normalized = String(targetPath || '').replace(/[\\/]+$/g, '');
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : '';
}

contextBridge.exposeInMainWorld('leagueProfileTool', {
  request: (options: RequestOptions): Promise<string> => ipcRenderer.invoke('lpt:request', options),
  findLockfile: (targetPaths: string[]): Promise<string> => ipcRenderer.invoke('lpt:find-lockfile', targetPaths),
  readLockfile: (targetPath: string): Promise<string> => ipcRenderer.invoke('lpt:read-lockfile', targetPath),
  readConfiguredClientPath: (): Promise<string> => ipcRenderer.invoke('lpt:read-configured-client-path'),
  chooseClientPath: (): Promise<string> => ipcRenderer.invoke('lpt:choose-client-path'),
  writeClipboard: (text: string): Promise<void> => ipcRenderer.invoke('lpt:write-clipboard', text),
  joinPath: (...parts: string[]): string => joinPathParts(...parts),
  dirname: (targetPath: string): string => parentPath(targetPath),
  openExternal: (targetUrl: string): Promise<void> => ipcRenderer.invoke('lpt:open-external', targetUrl),
  connectLcuEvents: async (
    options: LcuEventConnectionOptions,
    onEvent: LcuEventCallback,
    onState: LcuEventStateCallback
  ): Promise<void> => {
    clearLcuEventListeners();
    eventListener = (_event, payload) => onEvent(payload);
    stateListener = (_event, state) => onState(state);
    ipcRenderer.on('lpt:events-data', eventListener);
    ipcRenderer.on('lpt:events-state', stateListener);
    try {
      await ipcRenderer.invoke('lpt:events-connect', options);
    } catch (error) {
      clearLcuEventListeners();
      throw error;
    }
  },
  disconnectLcuEvents: async (): Promise<void> => {
    clearLcuEventListeners();
    await ipcRenderer.invoke('lpt:events-disconnect');
  }
});
