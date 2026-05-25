import { Injectable } from '@angular/core';
import { ElectronService } from "..";
import {Options} from "./options";
import {Data} from "./data";

@Injectable({
  providedIn: 'root'
})
export class ConnectorService {
  connector: Options;
  private retryTimer: any;
  private connecting = false;
  private lockfilePath: string;
  private ready = false;
  private installPathCandidates: string[] = [];
  private lastProcessLookup = 0;
  private loggedMissingLockfile = false;

  constructor(private electronService: ElectronService) {
    if (!electronService.isElectron) return;

    const clientConnection = new electronService.LCUConnector();
    const configuredPath = this.readConfiguredClientPath();
    if (configuredPath) {
      this.addInstallPathCandidate(configuredPath);
      // @ts-ignore
      clientConnection._dirPath = configuredPath; // Use user specified client path
      clientConnection.on('connect', (data: Data) => {
        this.verifyAndSetConnection(data, 'lcu-connector event');
        clientConnection.stop();
      });
      clientConnection.on('disconnect', () => {
        this.setReady(false, 'lcu-connector disconnect');
      });
      clientConnection.start();
    } else {
      console.warn('[LCU] config/clientPath.txt unavailable; falling back to dynamic lockfile discovery.');
    }
    this.startRetryLoop();
  }

  private startRetryLoop() {
    this.getCommonInstallPaths().forEach(path => this.addInstallPathCandidate(path));
    this.tryConnectFromLockfile('startup');
    this.retryTimer = setInterval(() => this.tryConnectFromLockfile('retry'), 3000);
  }

  private async tryConnectFromLockfile(source: string) {
    if (this.connecting) return;
    this.connecting = true;
    try {
      const lockfilePath = this.findLockfilePath();
      if (!lockfilePath) {
        if (this.connector && this.lockfilePath && !this.electronService.fs.existsSync(this.lockfilePath)) {
          this.setReady(false, 'lockfile removed');
        }
        if (!this.loggedMissingLockfile) {
          this.loggedMissingLockfile = true;
          console.warn(`[LCU] lockfile not found during ${source}; retrying.`);
        }
        return;
      }
      this.loggedMissingLockfile = false;

      const data = this.parseLockfile(lockfilePath);
      if (!data) return;

      const url = `${data.protocol}://${data.address}:${data.port}`;
      if (this.connector && this.connector.url === url && this.lockfilePath === lockfilePath) return;

      this.lockfilePath = lockfilePath;
      await this.verifyAndSetConnection(data, source);
    } finally {
      this.connecting = false;
    }
  }

  private findLockfilePath(): string {
    if (this.lockfilePath && this.electronService.fs.existsSync(this.lockfilePath)) return this.lockfilePath;

    const processPath = this.getLeagueClientPathFromProcess();
    if (processPath) this.addInstallPathCandidate(processPath);

    for (const candidate of this.installPathCandidates) {
      if (!candidate) continue;
      const lockfilePath = this.electronService.path.join(this.normalizeClientPath(candidate), 'lockfile');
      if (this.electronService.fs.existsSync(lockfilePath)) {
        return lockfilePath;
      }
    }

    return null;
  }

  private readConfiguredClientPath(): string {
    try {
      return this.normalizeClientPath(this.electronService.fs.readFileSync("config\\clientPath.txt").toString());
    } catch (err) {
      return null;
    }
  }

  private getLeagueClientPathFromProcess(): string {
    const now = Date.now();
    if (now - this.lastProcessLookup < 15000) return null;
    this.lastProcessLookup = now;

    const executablePath = this.execCommand('powershell.exe -NoProfile -Command "(Get-Process LeagueClientUx -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)"');
    if (executablePath) return this.normalizeClientPath(this.electronService.path.dirname(executablePath));

    const commandLine = this.execCommand('powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"name = \'LeagueClientUx.exe\'\\" | Select-Object -First 1 -ExpandProperty CommandLine)"');
    const match = commandLine && commandLine.match(/--install-directory=(?:"([^"]+)"|([^ ]+))/);
    if (match) return this.normalizeClientPath(match[1] || match[2]);

    return null;
  }

  private getCommonInstallPaths(): string[] {
    return [
      'C:\\Riot Games\\League of Legends',
      'D:\\Riot Games\\League of Legends',
      'F:\\Riot Games\\League of Legends',
      'C:\\Program Files\\Riot Games\\League of Legends',
      'C:\\Program Files (x86)\\Riot Games\\League of Legends'
    ];
  }

  private addInstallPathCandidate(candidate: string) {
    const path = this.normalizeClientPath(candidate);
    if (path && this.installPathCandidates.indexOf(path) < 0) {
      this.installPathCandidates.push(path);
    }
  }

  private execCommand(command: string): string {
    try {
      return this.electronService.childProcess.execSync(command, {encoding: 'utf8', windowsHide: true}).trim();
    } catch (err) {
      return '';
    }
  }

  private parseLockfile(lockfilePath: string): Data {
    try {
      const parts = this.electronService.fs.readFileSync(lockfilePath).toString().trim().split(':');
      if (parts.length < 5) {
        console.error('[LCU] invalid lockfile format', lockfilePath);
        return null;
      }
      const data = {
        address: '127.0.0.1',
        username: 'riot',
        port: parseInt(parts[2], 10),
        password: parts[3],
        protocol: parts[4]
      };
      return data;
    } catch (err) {
      console.error('[LCU] failed to parse lockfile', err);
      return null;
    }
  }

  private async verifyAndSetConnection(data: Data, source: string) {
    const nextConnector = this.buildConnectorOptions(data);
    const requestOptions = JSON.parse(JSON.stringify(nextConnector));
    requestOptions.method = 'GET';
    requestOptions.url += '/lol-summoner/v1/current-summoner';
    try {
      await this.electronService.request(requestOptions);
      this.connector = nextConnector;
      this.setReady(true, source);
    } catch (err) {
      this.setReady(false, 'auth failed');
      console.error('[LCU] auth failed', err && (err.message || err.error || err));
    }
  }

  private buildConnectorOptions(data: Data): Options {
    return {
      rejectUnauthorized: false,
      headers: {
        Accept: "application/json",
        Authorization: "Basic " + btoa(`${data["username"]}:${data["password"]}`)
      },
      url: `${data["protocol"]}://${data["address"]}:${data["port"]}`
    };
  }

  private setReady(ready: boolean, reason: string) {
    if (!ready) this.connector = null;
    if (this.ready !== ready) {
      this.ready = ready;
    }
  }

  public isReady(): boolean {
    return this.ready;
  }

  private normalizeClientPath(clientPath: string): string {
    const path = clientPath.trim().replace(/^"|"$/g, '');
    if (!path) return '';
    if (path.toLowerCase().endsWith('.exe')) return this.electronService.path.dirname(path);
    return path;
  }
}
