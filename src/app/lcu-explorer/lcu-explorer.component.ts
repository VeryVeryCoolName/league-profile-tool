import {Component, OnDestroy} from '@angular/core';
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";
import {ConnectorService} from "../core/services/connector/connector.service";

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

interface DiagnosticField {
  path: string;
  value: string;
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
  diagnostics: DiagnosticField[];
  copyState: string;
  flatSnapshot: Record<string, string>;
}

interface ChallengeRankDiagnostic {
  label: string;
  value: string;
}

interface ComparisonResult {
  path: string;
  changedFields: string[];
}

interface IdentityTraceField {
  endpoint: string;
  path: string;
  value: string;
}

interface StateTimelineSnapshot {
  capturedAt: string;
  gameflowPhase: string;
  changedFields: string[];
  endpointCount: number;
  flatSnapshot: Record<string, string>;
}

@Component({
  selector: 'app-lcu-explorer',
  templateUrl: './lcu-explorer.component.html',
  styleUrls: ['./lcu-explorer.component.css']
})
export class LcuExplorerComponent implements OnDestroy {
  public query = '';
  public watchedEndpoint = '';
  public bulkRefreshing = false;
  public comparisonLeft: any = null;
  public comparisonRight: any = null;
  public comparisonError = '';
  public comparisonResults: ComparisonResult[] = [];
  public snapshotTimeline: StateTimelineSnapshot[] = [];
  public endpointStates: Record<string, EndpointState> = {};
  public endpointGroups: LcuEndpointGroup[] = [
    {
      name: 'Regalia',
      endpoints: [
        {method: 'GET', path: '/lol-regalia/v2/config', notes: 'Regalia configuration and mapping data'},
        {method: 'GET', path: '/lol-regalia/v2/current-regalia', notes: 'Current player regalia selection'},
        {method: 'GET', path: '/lol-regalia/v2/current-summoner/regalia', notes: 'Current summoner regalia payload'},
        {method: 'GET', path: '/lol-regalia/v2/regalia', notes: 'Regalia payload collection'},
        {method: 'GET', path: '/lol-regalia/v2/inventories', notes: 'Owned regalia inventory references'},
        {method: 'GET', path: '/lol-regalia/v2/crests', notes: 'Crest definitions and IDs'},
        {method: 'GET', path: '/lol-regalia/v2/banners', notes: 'Banner definitions and IDs'},
        {method: 'GET', path: '/lol-regalia/v2/profile', notes: 'Profile-facing regalia data'}
      ]
    },
    {
      name: 'Regalia Parameter Exploration',
      endpoints: [
        {method: 'GET', path: '/lol-regalia/v2/crests/0', notes: 'Probe crest parameter shape with ID 0'},
        {method: 'GET', path: '/lol-regalia/v2/banners/0', notes: 'Probe banner parameter shape with ID 0'},
        {method: 'GET', path: '/lol-regalia/v2/profile/0', notes: 'Probe profile parameter shape with ID 0'},
        {method: 'GET', path: '/lol-regalia/v2/regalia/0', notes: 'Probe regalia parameter shape with ID 0'},
        {method: 'GET', path: '/lol-regalia/v2/inventories/0', notes: 'Probe inventory parameter shape with ID 0'}
      ]
    },
    {
      name: 'Summoner-Bound Regalia',
      endpoints: [
        {method: 'GET', path: '/lol-regalia/v2/summoners/{summonerId}/regalia', notes: 'Regalia by current summonerId'},
        {method: 'GET', path: '/lol-regalia/v2/summoner-regalia/{summonerId}', notes: 'Alternate summoner regalia route by current summonerId'}
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
        {method: 'GET', path: '/lol-challenges/v1/player-preferences', notes: 'Selected challenge preferences'},
        {method: 'GET', path: '/lol-challenges/v1/percentiles', notes: 'Challenge percentile mappings'},
        {method: 'GET', path: '/lol-challenges/v2/titles/all', notes: 'All title definitions and title IDs'},
        {method: 'GET', path: '/lol-challenges/v2/titles/local-player', notes: 'Unlocked local player titles'}
      ]
    },
    {
      name: 'Hovercard / Presence',
      endpoints: [
        {method: 'GET', path: '/lol-chat/v1/me', notes: 'Live local chat presence payload'},
        {method: 'GET', path: '/lol-chat/v1/friends', notes: 'Friend presence and social payloads'},
        {method: 'GET', path: '/lol-hovercard/v1/profile-card', notes: 'Local hovercard profile-card structure'},
        {method: 'GET', path: '/lol-hovercard/v1/friend-info', notes: 'Hovercard friend-info structure'},
        {method: 'GET', path: '/lol-hovercard/v1/profile-card/{summonerId}', notes: 'Hovercard profile-card by current summonerId'},
        {method: 'GET', path: '/lol-hovercard/v1/friend-info/{puuid}', notes: 'Hovercard friend-info by current puuid'}
      ]
    },
    {
      name: 'Challenge Identity Tracing',
      endpoints: [
        {method: 'GET', path: '/lol-challenges/v1/summary-player-data/local-player', notes: 'Challenge score, crest, title, and crystal summary'},
        {method: 'GET', path: '/lol-challenges/v1/player-preferences', notes: 'Selected challenge/title preferences'},
        {method: 'GET', path: '/lol-challenges/v1/percentiles', notes: 'Challenge percentile and rank mapping data'}
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
  private readonly priorityComparisonEndpoints = [
    '/lol-chat/v1/me',
    '/lol-regalia/v2/current-summoner/regalia',
    '/lol-challenges/v1/summary-player-data/local-player',
    '/lol-summoner/v1/current-summoner/summoner-profile'
  ];
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
  private readonly diagnosticKeywords = [
    'banner',
    'border',
    'challenge',
    'contentid',
    'crest',
    'crystal',
    'gameflow',
    'hover',
    'icon',
    'itemid',
    'league',
    'presence',
    'profile',
    'puuid',
    'rank',
    'regalia',
    'selectedprestigecrest',
    'summonerid',
    'title',
    'tokenid',
    'cresttype',
    'bannertype'
  ];

  constructor(private lcuConnectionService: LCUConnectionService, private connectorService: ConnectorService) {
  }

  ngOnDestroy() {
    this.stopWatch();
  }

  public get filteredGroups() {
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

  public get challengeRankDiagnostics(): ChallengeRankDiagnostic[] {
    const chatState = this.ensureState('/lol-chat/v1/me');
    const lol = chatState.response && chatState.response.lol;
    const fields = [
      'challengeCrystalLevel',
      'challengePoints',
      'challengeTokensSelected',
      'regalia',
      'bannerIdSelected',
      'playerTitleSelected'
    ];

    return fields.map(field => {
      return {
        label: field,
        value: lol && Object.prototype.hasOwnProperty.call(lol, field) ? this.valueString(lol[field]) : ''
      };
    });
  }

  public get identityTraceLog(): IdentityTraceField[] {
    const explicitFields = [
      'summonerid',
      'puuid',
      'selectedprestigecrest',
      'cresttype',
      'bannertype',
      'challengepoints',
      'challengecrystallevel',
      'contentid',
      'itemid',
      'tokenid'
    ];
    const fields: IdentityTraceField[] = [];

    this.allEndpoints().forEach(endpoint => {
      const state = this.ensureState(endpoint.path);
      if (!state.fetchedAt) return;

      const payload = state.error || state.response;
      const flat = this.flattenResponse(payload);
      Object.keys(flat).forEach(path => {
        const normalizedPath = path.toLowerCase();
        const isExplicitField = explicitFields.some(field => normalizedPath.indexOf(field) >= 0);
        const isHovercardIdentity = endpoint.path.indexOf('/lol-hovercard/') >= 0 &&
          /identity|profile|summoner|puuid|icon|title|rank|crest|challenge|regalia/i.test(path);
        if (!isExplicitField && !isHovercardIdentity) return;

        fields.push({
          endpoint: state.resolvedPath || endpoint.path,
          path,
          value: flat[path]
        });
      });
    });

    return fields.slice(0, 500);
  }

  public stateFor(endpoint: LcuEndpoint): EndpointState {
    return this.ensureState(endpoint.path);
  }

  public async refresh(endpoint: LcuEndpoint, fromWatch = false, phaseOverride = '') {
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
    state.diagnostics = this.extractDiagnostics(parsed);
    state.flatSnapshot = nextFlatSnapshot;
    if (!fromWatch) state.expanded = true;

    if (endpoint.path === '/lol-gameflow/v1/gameflow-phase') {
      state.phaseAtFetch = formattedResponse.replace(/^"|"$/g, '');
    }
  }

  public refreshChatPresence() {
    const endpoint = this.findEndpoint('/lol-chat/v1/me');
    if (endpoint) this.refresh(endpoint);
  }

  public toggleExpanded(endpoint: LcuEndpoint) {
    const state = this.ensureState(endpoint.path);
    state.expanded = !state.expanded;
  }

  public toggleWatch(endpoint: LcuEndpoint) {
    if (this.watchedEndpoint === endpoint.path) {
      this.stopWatch();
      return;
    }

    this.stopWatch();
    this.watchedEndpoint = endpoint.path;
    this.refresh(endpoint);
    this.watchTimer = setInterval(() => this.refresh(endpoint, true), this.watchIntervalMs);
  }

  public copyResponse(endpoint: LcuEndpoint) {
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

  public exportResponse(endpoint: LcuEndpoint) {
    const state = this.ensureState(endpoint.path);
    if (!state.formattedResponse && !state.rawResponse) return;

    const payload = state.error ? state.error : state.response;
    this.downloadJson(this.redactForExport(payload), `${this.fileSafeEndpoint(endpoint.path)}.json`);
  }

  public exportAllResults() {
    this.downloadJson(this.buildExportPayload(), this.exportFilename());
  }

  public async refreshAllThenExport() {
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

  public loadComparisonFile(event: Event, side: 'left' | 'right') {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        if (side === 'left') {
          this.comparisonLeft = parsed;
        } else {
          this.comparisonRight = parsed;
        }
        this.comparisonError = '';
        this.compareExports();
      } catch (err) {
        this.comparisonError = `Could not parse ${file.name} as JSON.`;
      }
    };
    reader.readAsText(file);
  }

  public compareExports() {
    if (!this.comparisonLeft || !this.comparisonRight) {
      this.comparisonResults = [];
      return;
    }

    const leftEndpoints = this.exportEndpointMap(this.comparisonLeft);
    const rightEndpoints = this.exportEndpointMap(this.comparisonRight);
    const paths = this.sortedComparisonPaths(leftEndpoints, rightEndpoints);
    this.comparisonResults = paths
      .map(path => {
        const left = leftEndpoints[path] || null;
        const right = rightEndpoints[path] || null;
        const changedFields = this.changedFields(this.flattenResponse(left), this.flattenResponse(right));
        return {
          path,
          changedFields
        };
      })
      .filter(result => result.changedFields.length > 0);
  }

  public captureStateSnapshot() {
    const flatSnapshot = this.buildCurrentStateSnapshot();
    const previous = this.snapshotTimeline.length > 0
      ? this.snapshotTimeline[this.snapshotTimeline.length - 1].flatSnapshot
      : {};
    const snapshot = {
      capturedAt: new Date().toISOString(),
      gameflowPhase: this.exportedGameflowPhase(),
      changedFields: this.changedFields(previous, flatSnapshot),
      endpointCount: Object.keys(this.endpointStates).filter(path => this.endpointStates[path].fetchedAt).length,
      flatSnapshot
    };

    this.snapshotTimeline = this.snapshotTimeline.concat(snapshot).slice(-20);
  }

  public statusClass(status: EndpointStatus): string {
    if (status === '404') return 'not-found';
    return status.toLowerCase();
  }

  public trackByGroup(index: number, group: LcuEndpointGroup) {
    return group.name;
  }

  public trackByEndpoint(index: number, endpoint: LcuEndpoint) {
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
        diagnostics: [],
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

  private findEndpoint(path: string): LcuEndpoint {
    return this.allEndpoints().find(endpoint => endpoint.path === path);
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
    if (this.identityContextPromise) return this.identityContextPromise;

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
    this.flatten(value, '', output, {count: 0, max: 6000});
    return output;
  }

  private flatten(value: any, path: string, output: Record<string, string>, budget: {count: number; max: number}) {
    if (budget.count >= budget.max) return;

    if (value !== null && typeof value === 'object') {
      const keys = Array.isArray(value) ? value.map((item, index) => String(index)) : Object.keys(value);
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

  private extractDiagnostics(parsed: any): DiagnosticField[] {
    if (parsed === null || parsed === undefined) return [];

    const flat = this.flattenResponse(parsed);
    return Object.keys(flat)
      .filter(path => this.diagnosticKeywords.some(keyword => path.toLowerCase().indexOf(keyword) >= 0))
      .slice(0, 300)
      .map(path => {
        return {
          path,
          value: flat[path]
        };
      });
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

  private buildCurrentStateSnapshot(): Record<string, string> {
    const snapshot: Record<string, string> = {};
    this.allEndpoints().forEach(endpoint => {
      const state = this.ensureState(endpoint.path);
      if (!state.fetchedAt) return;

      const payload = state.error || state.response;
      const flat = this.flattenResponse(payload);
      Object.keys(flat).forEach(path => {
        snapshot[`${state.resolvedPath || endpoint.path}.${path}`] = flat[path];
      });
      snapshot[`${state.resolvedPath || endpoint.path}.__status`] = state.status;
      snapshot[`${state.resolvedPath || endpoint.path}.__httpStatus`] = this.valueString(state.httpStatus);
    });
    return snapshot;
  }

  private buildExportPayload(): Record<string, unknown> {
    return {
      app: 'League Profile Tool',
      version: '3.0.0',
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

  private exportEndpointMap(exportData: any): Record<string, any> {
    const map: Record<string, any> = {};
    const groups = exportData && Array.isArray(exportData.groups) ? exportData.groups : [];
    groups.forEach(group => {
      const endpoints = group && Array.isArray(group.endpoints) ? group.endpoints : [];
      endpoints.forEach(endpoint => {
        if (endpoint && endpoint.path) map[endpoint.path] = endpoint;
      });
    });
    return map;
  }

  private sortedComparisonPaths(left: Record<string, any>, right: Record<string, any>): string[] {
    const allPaths = Object.keys(left)
      .concat(Object.keys(right).filter(path => !Object.prototype.hasOwnProperty.call(left, path)));
    return allPaths.sort((a, b) => {
      const aPriority = this.priorityComparisonEndpoints.indexOf(a);
      const bPriority = this.priorityComparisonEndpoints.indexOf(b);
      if (aPriority >= 0 && bPriority >= 0) return aPriority - bPriority;
      if (aPriority >= 0) return -1;
      if (bPriority >= 0) return 1;
      return a.localeCompare(b);
    });
  }
}
