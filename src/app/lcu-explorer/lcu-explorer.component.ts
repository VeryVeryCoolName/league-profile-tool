import {Component, OnDestroy, ChangeDetectionStrategy} from '@angular/core';
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";
import {ConnectorService} from "../core/services/connector/connector.service";
import {APP_VERSION} from "../app-version";

type EndpointStatus = 'Idle' | 'Loading' | 'OK' | '404' | 'Unauthorized' | 'Empty' | 'Error';

interface LcuEndpoint {
  method: 'GET';
  path: string;
  notes: string;
}

interface LcuEndpointGroup {
  name: string;
  endpoints: LcuEndpoint[];
}

interface EndpointState {
  loading: boolean;
  expanded: boolean;
  status: EndpointStatus;
  rawResponse: string;
  formattedResponse: string;
  resolvedPath: string;
  lastFetched: string;
  fetchedAt: string;
  phaseAtFetch: string;
  httpStatus: number;
  response: any;
  error: any;
  changedFields: string[];
  copyState: string;
  flatSnapshot: Record<string, string>;
}

@Component({
    selector: 'app-lcu-explorer',
    templateUrl: './lcu-explorer.component.html',
    styleUrls: ['./lcu-explorer.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class LcuExplorerComponent implements OnDestroy {
  public query = '';
  public watchedEndpoint = '';
  public bulkRefreshing = false;
  public endpointStates: Record<string, EndpointState> = {};
  public endpointGroups: LcuEndpointGroup[] = [
    {
      name: 'Regalia',
      endpoints: [
        {method: 'GET', path: '/lol-regalia/v2/config', notes: 'Regalia configuration and mapping data'},
        {method: 'GET', path: '/lol-regalia/v2/current-summoner/regalia', notes: 'Current summoner regalia payload'},
        {method: 'GET', path: '/lol-regalia/v2/summoners/{summonerId}/regalia', notes: 'Regalia by current summonerId'},
        {method: 'GET', path: '/lol-regalia/v2/summoners/{summonerId}/regalia/async', notes: 'Async regalia by current summonerId'},
        {method: 'GET', path: '/lol-regalia/v2/summoners/{summonerId}/queues/RANKED_SOLO_5x5/regalia', notes: 'Solo/Duo queue-scoped regalia'},
        {method: 'GET', path: '/lol-regalia/v2/summoners/{summonerId}/queues/RANKED_FLEX_SR/regalia', notes: 'Flex queue-scoped regalia'}
      ]
    },
    {
      name: 'Challenges',
      endpoints: [
        {method: 'GET', path: '/lol-challenges/v1/client-state', notes: 'Challenge feature state'},
        {method: 'GET', path: '/lol-challenges/v1/challenges/local-player', notes: 'Raw local challenge progress'},
        {method: 'GET', path: '/lol-challenges/v1/summary-player-data/local-player', notes: 'Challenge score, crystal, crest, title summary'},
        {method: 'GET', path: '/lol-challenges/v1/challenges/category-data', notes: 'Challenge category and threshold mappings'},
        {method: 'GET', path: '/lol-challenges/v1/level-points', notes: 'Challenge level point thresholds'},
        {method: 'GET', path: '/lol-challenges/v2/titles/all', notes: 'All title definitions and title IDs'},
        {method: 'GET', path: '/lol-challenges/v2/titles/local-player', notes: 'Unlocked local player titles'}
      ]
    },
    {
      name: 'Hovercard / Presence',
      endpoints: [
        {method: 'GET', path: '/lol-chat/v1/me', notes: 'Live local chat presence payload'},
        {method: 'GET', path: '/lol-chat/v1/friends', notes: 'Friend presence and social payloads'},
        {method: 'GET', path: '/lol-hovercard/v1/friend-info/{puuid}', notes: 'Hovercard friend-info by current puuid'}
      ]
    },
    {
      name: 'Summoner / Profile',
      endpoints: [
        {method: 'GET', path: '/lol-summoner/v1/current-summoner', notes: 'Current summoner identity'},
        {method: 'GET', path: '/lol-summoner/v1/current-summoner/summoner-profile', notes: 'Profile background, banner, crest, and regalia strings'},
        {method: 'GET', path: '/lol-login/v1/session', notes: 'Login/session region and account context'}
      ]
    },
    {
      name: 'Diagnostics',
      endpoints: [
        {method: 'GET', path: '/lol-gameflow/v1/gameflow-phase', notes: 'Lobby, champ select, in-game, and end-of-game phase'},
        {method: 'GET', path: '/lol-lobby/v2/lobby', notes: 'Lobby/social context when available'}
      ]
    }
  ];

  private watchTimer: any = null;
  private identityContext: Record<string, string> = {};
  private identityContextPromise: Promise<Record<string, string>> = null;
  private readonly watchIntervalMs = 5000;
  private readonly sensitiveExportKeys = [
    'idtoken',
    'accesstoken',
    'userauthtoken',
    'token',
    'auth',
    'password',
    'entitlement',
    'jwt'
  ];

  constructor(private lcuConnectionService: LCUConnectionService, private connectorService: ConnectorService) {
  }

  ngOnDestroy(): void {
    this.stopWatch();
  }

  public get filteredGroups(): LcuEndpointGroup[] {
    const search = this.query.toLowerCase().trim();
    return this.endpointGroups
      .map(group => {
        return {
          name: group.name,
          endpoints: group.endpoints.filter(endpoint => {
            if (!search) return true;
            return endpoint.path.toLowerCase().indexOf(search) >= 0 ||
              endpoint.notes.toLowerCase().indexOf(search) >= 0 ||
              group.name.toLowerCase().indexOf(search) >= 0;
          })
        };
      })
      .filter(group => group.endpoints.length > 0);
  }

  public stateFor(endpoint: LcuEndpoint): EndpointState {
    return this.ensureState(endpoint.path);
  }

  public async refresh(endpoint: LcuEndpoint, fromWatch = false, phaseOverride = ''): Promise<void> {
    const state = this.ensureState(endpoint.path);
    if (state.loading) return;

    state.loading = true;
    state.status = 'Loading';
    state.copyState = '';
    const resolvedPath = await this.resolveEndpointPath(endpoint.path);
    state.resolvedPath = resolvedPath;
    state.phaseAtFetch = endpoint.path === '/lol-gameflow/v1/gameflow-phase'
      ? 'Self'
      : phaseOverride || await this.readGameflowPhase();

    const response = await this.lcuConnectionService.requestCustomAPI({}, endpoint.method, resolvedPath);
    const parsed = this.parseResponse(response);
    const rawResponse = this.rawString(response);
    const formattedResponse = this.formatResponse(response, parsed);
    const nextFlatSnapshot = this.flattenResponse(parsed === null ? rawResponse : parsed);
    const fetchedAt = new Date();
    const status = this.statusFor(response, parsed);

    state.loading = false;
    state.status = status;
    state.rawResponse = rawResponse;
    state.formattedResponse = formattedResponse;
    state.resolvedPath = resolvedPath;
    state.lastFetched = fetchedAt.toLocaleTimeString();
    state.fetchedAt = fetchedAt.toISOString();
    state.httpStatus = this.httpStatusFor(status, parsed);
    state.response = parsed === null ? rawResponse : parsed;
    state.error = this.errorFor(status, parsed, rawResponse);
    state.changedFields = this.changedFields(state.flatSnapshot, nextFlatSnapshot);
    state.flatSnapshot = nextFlatSnapshot;
    if (!fromWatch) state.expanded = true;

    if (endpoint.path === '/lol-gameflow/v1/gameflow-phase') {
      state.phaseAtFetch = formattedResponse.replace(/^"|"$/g, '');
    }
  }

  public toggleExpanded(endpoint: LcuEndpoint): void {
    const state = this.ensureState(endpoint.path);
    state.expanded = !state.expanded;
  }

  public toggleWatch(endpoint: LcuEndpoint): void {
    if (this.watchedEndpoint === endpoint.path) {
      this.stopWatch();
      return;
    }

    this.stopWatch();
    this.watchedEndpoint = endpoint.path;
    void this.refresh(endpoint);
    this.watchTimer = setInterval(() => {
      void this.refresh(endpoint, true);
    }, this.watchIntervalMs);
  }

  public copyResponse(endpoint: LcuEndpoint): void {
    const state = this.ensureState(endpoint.path);
    const text = state.formattedResponse || state.rawResponse;
    if (!text) return;

    this.copyText(text)
      .then(() => {
        state.copyState = 'Copied';
        setTimeout(() => state.copyState = '', 1500);
      })
      .catch(() => {
        state.copyState = 'Copy failed';
      });
  }

  public exportResponse(endpoint: LcuEndpoint): void {
    const state = this.ensureState(endpoint.path);
    if (!state.formattedResponse && !state.rawResponse) return;

    const payload = state.error ? state.error : state.response;
    this.downloadJson(this.redactForExport(payload), `${this.fileSafeEndpoint(endpoint.path)}.json`);
  }

  public exportAllResults(): void {
    this.downloadJson(this.buildExportPayload(), this.exportFilename());
  }

  public async refreshAllThenExport(): Promise<void> {
    if (this.bulkRefreshing) return;

    this.stopWatch();
    this.bulkRefreshing = true;
    try {
      const phase = await this.readGameflowPhase();
      for (const endpoint of this.allEndpoints()) {
        await this.refresh(endpoint, true, phase);
        await this.delay(200);
      }
      this.exportAllResults();
    } finally {
      this.bulkRefreshing = false;
    }
  }

  public statusClass(status: EndpointStatus): string {
    if (status === '404') return 'not-found';
    return status.toLowerCase();
  }

  public trackByGroup(_index: number, group: LcuEndpointGroup): string {
    return group.name;
  }

  public trackByEndpoint(_index: number, endpoint: LcuEndpoint): string {
    return endpoint.path;
  }

  private ensureState(path: string): EndpointState {
    if (!this.endpointStates[path]) {
      this.endpointStates[path] = {
        loading: false,
        expanded: false,
        status: 'Idle',
        rawResponse: '',
        formattedResponse: '',
        resolvedPath: path,
        lastFetched: '',
        fetchedAt: '',
        phaseAtFetch: '',
        httpStatus: null,
        response: null,
        error: null,
        changedFields: [],
        copyState: '',
        flatSnapshot: {}
      };
    }
    return this.endpointStates[path];
  }

  private stopWatch() {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
    this.watchedEndpoint = '';
  }

  private async resolveEndpointPath(path: string): Promise<string> {
    if (path.indexOf('{summonerId}') < 0 && path.indexOf('{puuid}') < 0) return path;

    const context = await this.loadIdentityContext();
    return path
      .replace('{summonerId}', context.summonerId || '{summonerId}')
      .replace('{puuid}', context.puuid || '{puuid}');
  }

  private async loadIdentityContext(): Promise<Record<string, string>> {
    if (this.identityContext.summonerId && this.identityContext.puuid) return this.identityContext;
    if (this.identityContextPromise !== null) return this.identityContextPromise;

    this.identityContextPromise = this.lcuConnectionService.requestCustomAPI({}, 'GET', '/lol-summoner/v1/current-summoner')
      .then(response => {
        const summoner = this.parseResponse(response) || {};
        this.identityContext = {
          summonerId: summoner.summonerId !== undefined && summoner.summonerId !== null ? String(summoner.summonerId) : '',
          puuid: summoner.puuid ? String(summoner.puuid) : ''
        };
        this.identityContextPromise = null;
        return this.identityContext;
      })
      .catch(() => {
        this.identityContextPromise = null;
        return this.identityContext;
      });

    return this.identityContextPromise;
  }

  private async readGameflowPhase(): Promise<string> {
    const response = await this.lcuConnectionService.requestCustomAPI({}, 'GET', '/lol-gameflow/v1/gameflow-phase');
    const parsed = this.parseResponse(response);
    if (typeof parsed === 'string') return parsed;
    if (parsed === null) return this.rawString(response);
    return this.formatResponse(response, parsed);
  }

  private parseResponse(response: any): any {
    if (typeof response !== 'string') return response;
    try {
      return JSON.parse(response);
    } catch (err) {
      return null;
    }
  }

  private rawString(response: any): string {
    if (response === undefined || response === null) return '';
    if (typeof response === 'string') return response;
    return JSON.stringify(response);
  }

  private formatResponse(response: any, parsed = this.parseResponse(response)): string {
    if (parsed !== null) {
      return JSON.stringify(parsed, null, 2);
    }
    return this.rawString(response);
  }

  private statusFor(response: any, parsed: any): EndpointStatus {
    const raw = this.rawString(response).trim();
    if (!raw) return 'Empty';

    if (parsed !== null) {
      if (this.isHttpErrorPayload(parsed)) {
        const httpStatus = Number(parsed.httpStatus);
        if (httpStatus === 404) return '404';
        if (httpStatus === 401 || httpStatus === 403) return 'Unauthorized';
        return 'Error';
      }
      if (Array.isArray(parsed) && parsed.length === 0) return 'Empty';
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 0) return 'Empty';
      return 'OK';
    }

    if (/^404\b|httpstatus["':\s]+404/i.test(raw)) return '404';
    if (/unauthorized|forbidden|^401\b|^403\b/i.test(raw)) return 'Unauthorized';
    if (/lcu connection is not ready|not connected|connection refused/i.test(raw)) return 'Error';
    if (/failed|error/i.test(raw)) return 'Error';
    return 'OK';
  }

  private httpStatusFor(status: EndpointStatus, parsed: any): number {
    const httpStatus = this.isHttpErrorPayload(parsed) ? Number(parsed.httpStatus) : NaN;
    if (!isNaN(httpStatus)) return httpStatus;
    if (status === 'OK' || status === 'Empty') return 200;
    if (status === '404') return 404;
    return null;
  }

  private errorFor(status: EndpointStatus, parsed: any, rawResponse: string): any {
    if (status === 'OK' || status === 'Empty') return null;
    if (parsed && typeof parsed === 'object') return parsed;
    return rawResponse ? {message: rawResponse} : {message: status};
  }

  private isHttpErrorPayload(parsed: any): boolean {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const httpStatus = Number(parsed.httpStatus);
    if (isNaN(httpStatus) || httpStatus < 400) return false;
    return parsed.errorCode !== undefined ||
      parsed.message !== undefined ||
      parsed.implementationDetails !== undefined;
  }

  private flattenResponse(value: any): Record<string, string> {
    const output: Record<string, string> = {};
    this.flatten(value, '', output, {count: 0, max: 2500});
    return output;
  }

  private flatten(value: any, path: string, output: Record<string, string>, budget: {count: number; max: number}) {
    if (budget.count >= budget.max) return;

    if (value !== null && typeof value === 'object') {
      const keys = Array.isArray(value) ? value.map((_item, index) => String(index)) : Object.keys(value);
      if (keys.length === 0) {
        output[path || '(root)'] = Array.isArray(value) ? '[]' : '{}';
        budget.count++;
        return;
      }

      keys.forEach(key => {
        if (budget.count >= budget.max) return;
        const nextPath = path ? `${path}.${key}` : key;
        this.flatten(value[key], nextPath, output, budget);
      });
      return;
    }

    output[path || '(root)'] = this.valueString(value);
    budget.count++;
  }

  private changedFields(previous: Record<string, string>, next: Record<string, string>): string[] {
    if (!previous || Object.keys(previous).length === 0) return [];

    const changed = Object.keys(next)
      .filter(key => previous[key] !== next[key]);
    const removed = Object.keys(previous)
      .filter(key => !Object.prototype.hasOwnProperty.call(next, key))
      .map(key => `${key} (removed)`);
    return changed.concat(removed).slice(0, 120);
  }

  private valueString(value: any): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch (err) {
      return String(value);
    }
  }

  private copyText(text: string): Promise<void> {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    return Promise.resolve();
  }

  private fileSafeEndpoint(path: string): string {
    return path.replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/g, '') || 'lcu-response';
  }

  private allEndpoints(): LcuEndpoint[] {
    return this.endpointGroups.reduce((endpoints, group) => endpoints.concat(group.endpoints), []);
  }

  private buildExportPayload(): Record<string, unknown> {
    return {
      app: 'League Profile Tool',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      gameflowPhase: this.exportedGameflowPhase(),
      lcuConnected: this.connectorService.isReady(),
      groups: this.endpointGroups.map(group => {
        return {
          name: group.name,
          endpoints: group.endpoints
            .filter(endpoint => this.hasLoadedResult(endpoint))
            .map(endpoint => this.exportEndpoint(endpoint))
        };
      })
    };
  }

  private hasLoadedResult(endpoint: LcuEndpoint): boolean {
    return !!this.ensureState(endpoint.path).fetchedAt;
  }

  private exportEndpoint(endpoint: LcuEndpoint): Record<string, unknown> {
    const state = this.ensureState(endpoint.path);
    return {
      method: endpoint.method,
      path: endpoint.path,
      resolvedPath: state.resolvedPath || endpoint.path,
      status: state.status,
      httpStatus: state.httpStatus,
      fetchedAt: state.fetchedAt || null,
      phaseAtFetch: state.phaseAtFetch || null,
      response: state.error ? null : this.redactForExport(state.response),
      error: this.redactForExport(state.error),
      changedFields: state.changedFields
    };
  }

  private exportedGameflowPhase(): string {
    const gameflowState = this.ensureState('/lol-gameflow/v1/gameflow-phase');
    if (gameflowState.fetchedAt && !gameflowState.error) return this.valueString(gameflowState.response);

    const loadedStates = Object.keys(this.endpointStates)
      .map(path => this.endpointStates[path])
      .filter(state => state.fetchedAt && state.phaseAtFetch && state.phaseAtFetch !== 'Self');
    if (loadedStates.length === 0) return null;
    return loadedStates[loadedStates.length - 1].phaseAtFetch;
  }

  private downloadJson(payload: Record<string, unknown>, filename: string) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json;charset=utf-8'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private exportFilename(): string {
    const timestamp = new Date().toISOString()
      .replace(/T/, '-')
      .replace(/\..+$/, '')
      .replace(/:/g, '-');
    return `league-profile-tool-lcu-export-${timestamp}.json`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private redactForExport(value: any, key = ''): any {
    if (this.isSensitiveKey(key)) return '[REDACTED]';
    if (typeof value === 'string') return this.isJwtLike(value) ? '[REDACTED]' : value;
    if (Array.isArray(value)) return value.map(item => this.redactForExport(item));
    if (value && typeof value === 'object') {
      const clone = {};
      Object.keys(value).forEach(childKey => {
        clone[childKey] = this.redactForExport(value[childKey], childKey);
      });
      return clone;
    }
    return value;
  }

  private isSensitiveKey(key: string): boolean {
    const normalizedKey = String(key || '').toLowerCase();
    if (this.sensitiveExportKeys.indexOf(normalizedKey) >= 0) return true;
    if (normalizedKey.indexOf('password') >= 0) return true;
    if (normalizedKey.indexOf('jwt') >= 0) return true;
    if (normalizedKey.indexOf('auth') >= 0) return true;
    if (normalizedKey.indexOf('entitlement') >= 0) return true;
    return normalizedKey.endsWith('token') || normalizedKey.endsWith('tokens');
  }

  private isJwtLike(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed.length < 60) return false;
    return /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/.test(trimmed);
  }

}
