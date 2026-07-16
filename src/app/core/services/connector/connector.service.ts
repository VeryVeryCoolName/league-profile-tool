import {Injectable, OnDestroy} from '@angular/core';
import {BehaviorSubject, Observable} from 'rxjs';
import {ClientInstallInfo, ElectronService, RequestOptions} from '..';
import {Options} from './options';
import {Data} from './data';

@Injectable({
  providedIn: 'root'
})
export class ConnectorService implements OnDestroy {
  private readonly readySubject = new BehaviorSubject<boolean>(false);
  public readonly ready$: Observable<boolean> = this.readySubject.asObservable();
  private readonly installPathSubject = new BehaviorSubject<string>('');
  public readonly installPath$: Observable<string> = this.installPathSubject.asObservable();
  public connector: Options | null = null;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private connecting = false;
  private connectToken = 0;
  private lockfilePath = '';
  private lockfileSignature = '';
  private ready = false;
  private installPath = '';
  private loggedMissingLockfile = false;

  constructor(private electronService: ElectronService) {
    if (!electronService.isElectron) return;
    setTimeout(() => {
      void this.initializeConnector();
    }, 0);
  }

  ngOnDestroy(): void {
    if (this.retryTimer !== null) clearInterval(this.retryTimer);
  }

  private async initializeConnector(): Promise<void> {
    const configuredPath = await this.readConfiguredClientPath();
    if (configuredPath) {
      this.setInstallPath(configuredPath);
      this.startRetryLoop();
    }
  }

  private startRetryLoop(): void {
    if (this.retryTimer !== null || !this.installPath) return;
    void this.tryConnectFromLockfile('startup');
    this.retryTimer = setInterval(() => {
      void this.tryConnectFromLockfile('retry');
    }, 3000);
  }

  private async tryConnectFromLockfile(source: string, force = false): Promise<void> {
    if (this.connecting && !force) return;
    const token = ++this.connectToken;
    this.connecting = true;
    try {
      const lockfilePath = await this.findLockfilePath();
      if (token !== this.connectToken) return;
      if (!lockfilePath) {
        if (this.connector && this.lockfilePath) this.setReady(false);
        if (!this.loggedMissingLockfile) {
          this.loggedMissingLockfile = true;
          console.warn(`[LCU] lockfile not found during ${source}; retrying.`);
        }
        return;
      }
      this.loggedMissingLockfile = false;

      const data = await this.parseLockfile(lockfilePath);
      if (token !== this.connectToken) return;
      if (!data) {
        if (this.connector) this.setReady(false);
        return;
      }

      const connectorUrl = `${data.protocol}://${data.address}:${data.port}`;
      const lockfileSignature = this.lockfileSignatureFor(data);
      if (this.connector && this.connector.url === connectorUrl && this.lockfilePath === lockfilePath && this.lockfileSignature === lockfileSignature) return;

      if (this.connector) this.setReady(false);
      this.lockfilePath = lockfilePath;
      this.lockfileSignature = lockfileSignature;
      await this.verifyAndSetConnection(data, token);
    } finally {
      if (token === this.connectToken) this.connecting = false;
    }
  }

  private async findLockfilePath(): Promise<string> {
    if (!this.installPath) return '';
    const lockfile = this.electronService.joinPath(this.installPath, 'lockfile');
    return lockfile ? this.electronService.findLockfile([lockfile]) : '';
  }

  private async readConfiguredClientPath(): Promise<string> {
    try {
      return this.normalizeClientPath(await this.electronService.readConfiguredClientPath());
    } catch {
      return '';
    }
  }

  private setInstallPath(candidate: string): void {
    const clientPath = this.normalizeClientPath(candidate);
    if (clientPath === this.installPath) return;
    this.installPath = clientPath;
    this.installPathSubject.next(clientPath);
  }

  private async parseLockfile(lockfilePath: string): Promise<Data | null> {
    try {
      const parts = (await this.electronService.readLockfile(lockfilePath)).trim().split(':');
      if (parts.length < 5) {
        console.error('[LCU] invalid lockfile format', lockfilePath);
        return null;
      }
      return {
        address: '127.0.0.1',
        username: 'riot',
        port: parseInt(parts[2], 10),
        password: parts[3],
        protocol: parts[4]
      };
    } catch (error) {
      console.error('[LCU] failed to parse lockfile', error);
      return null;
    }
  }

  private async verifyAndSetConnection(data: Data, token: number): Promise<void> {
    const nextConnector = this.buildConnectorOptions(data);
    const requestOptions: RequestOptions = {
      ...nextConnector,
      headers: {...nextConnector.headers},
      method: 'GET',
      timeoutMs: 5000,
      url: `${nextConnector.url}/lol-summoner/v1/current-summoner`
    };
    try {
      await this.electronService.request(requestOptions);
      if (token !== this.connectToken) return;
      this.connector = nextConnector;
      this.setReady(true);
    } catch (error) {
      if (token !== this.connectToken) return;
      this.setReady(false);
      console.error('[LCU] auth failed', error instanceof Error ? error.message : error);
    }
  }

  private buildConnectorOptions(data: Data): Options {
    return {
      rejectUnauthorized: false,
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${btoa(`${data.username}:${data.password}`)}`
      },
      url: `${data.protocol}://${data.address}:${data.port}`
    };
  }

  private setReady(ready: boolean): void {
    if (!ready) {
      this.connector = null;
      this.lockfileSignature = '';
    }
    if (this.ready === ready) return;
    this.ready = ready;
    this.readySubject.next(ready);
  }

  public isReady(): boolean {
    return this.ready;
  }

  public getInstallPath(): string {
    return this.installPath;
  }

  public listClientPaths(): Promise<ClientInstallInfo[]> {
    return this.electronService.listClientPaths();
  }

  public async selectClientPath(clientPath: string): Promise<string> {
    const selectedPath = this.normalizeClientPath(await this.electronService.setClientPath(clientPath));
    if (!selectedPath) return '';

    this.applySelectedPath(selectedPath);
    void this.tryConnectFromLockfile('install switch', true);
    return selectedPath;
  }

  public async chooseClientPath(): Promise<string> {
    const selectedPath = this.normalizeClientPath(await this.electronService.chooseClientPath());
    if (!selectedPath) return '';

    this.applySelectedPath(selectedPath);
    void this.tryConnectFromLockfile('manual selection', true);
    return selectedPath;
  }

  private applySelectedPath(selectedPath: string): void {
    this.connectToken++;
    this.connecting = false;
    this.setInstallPath(selectedPath);
    this.lockfilePath = '';
    this.lockfileSignature = '';
    this.loggedMissingLockfile = false;
    this.setReady(false);
    this.startRetryLoop();
  }

  private lockfileSignatureFor(data: Data): string {
    return `${data.protocol}:${data.port}:${data.password}`;
  }

  private normalizeClientPath(clientPath: string): string {
    const normalized = String(clientPath || '').trim().replace(/^"|"$/g, '');
    if (!normalized) return '';
    if (normalized.toLowerCase().endsWith('.exe')) return this.electronService.dirname(normalized);
    return normalized;
  }
}
