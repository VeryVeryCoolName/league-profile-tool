import {Component, ChangeDetectionStrategy} from '@angular/core';
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";

interface EndpointPreset {
  label: string;
  method: string;
  endpoint: string;
  body?: string;
}

@Component({
    selector: 'app-customapi',
    templateUrl: './customapi.component.html',
    styleUrls: ['./customapi.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class CustomapiComponent {
  public methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  public endpointPresets: EndpointPreset[] = [
    {label: 'Current Summoner', method: 'GET', endpoint: '/lol-summoner/v1/current-summoner'},
    {label: 'Chat Presence', method: 'GET', endpoint: '/lol-chat/v1/me'},
    {label: 'Gameflow Phase', method: 'GET', endpoint: '/lol-gameflow/v1/gameflow-phase'},
    {label: 'Current Lobby', method: 'GET', endpoint: '/lol-lobby/v2/lobby'},
    {label: 'Lobby Members', method: 'GET', endpoint: '/lol-lobby/v2/lobby/members'},
    {label: 'Lobby Invitations', method: 'GET', endpoint: '/lol-lobby/v2/lobby/invitations'},
    {label: 'Received Lobby Invitations', method: 'GET', endpoint: '/lol-lobby/v2/received-invitations'},
    {label: 'Lobby Notifications', method: 'GET', endpoint: '/lol-lobby/v2/notifications'},
    {label: 'Lobby Search State', method: 'GET', endpoint: '/lol-lobby/v2/lobby/matchmaking/search-state'},
    {label: 'Party Active', method: 'GET', endpoint: '/lol-lobby/v2/party-active'},
    {label: 'Party EOG Status', method: 'GET', endpoint: '/lol-lobby/v2/party/eog-status'},
    {label: 'AGS Activity Id', method: 'GET', endpoint: '/lol-lobby/v2/ags/agsActivityId'},
    {label: 'Lobby Smart URL ({activityId})', method: 'GET', endpoint: '/lol-lobby/v2/ags/{activityId}/joinCode'},
    {label: 'Lobby Smart URL (lol)', method: 'GET', endpoint: '/lol-lobby/v2/ags/lol/joinCode'},
    {label: 'Lobby Smart URL (league_of_legends)', method: 'GET', endpoint: '/lol-lobby/v2/ags/league_of_legends/joinCode'},
    {label: 'Lobby Availability', method: 'GET', endpoint: '/lol-lobby/v1/lobby/availability'},
    {label: 'Lobby Countdown', method: 'GET', endpoint: '/lol-lobby/v1/lobby/countdown'},
    {label: 'Party Rewards', method: 'GET', endpoint: '/lol-lobby/v1/party-rewards'},
    {label: 'Friend List', method: 'GET', endpoint: '/lol-chat/v1/friends'},
    {label: 'Friend Counts', method: 'GET', endpoint: '/lol-chat/v1/friend-counts'},
    {label: 'Friend Groups', method: 'GET', endpoint: '/lol-chat/v1/friend-groups'},
    {label: 'Discord Link Status', method: 'GET', endpoint: '/lol-chat/v1/discord-link-status'},
    {label: 'Discord Integration Enabled', method: 'GET', endpoint: '/lol-chat/v1/is-discord-integration-enabled'},
    {label: 'Discord Link Available', method: 'GET', endpoint: '/lol-chat/v1/is-discord-link-available'},
    {label: 'Discord Linked', method: 'GET', endpoint: '/lol-chat/v1/is-discord-linked'},
    {label: 'External Plugin Availability', method: 'GET', endpoint: '/plugin-manager/v1/external-plugins/availability'},
    {label: 'Game Invites Enabled', method: 'GET', endpoint: '/lol-platform-config/v1/namespaces/GameInvites/ServiceEnabled'},
    {label: 'Game Invites Lobby Creation', method: 'GET', endpoint: '/lol-platform-config/v1/namespaces/GameInvites/LobbyCreationEnabled'},
    {label: 'Game Invites Bulk Max Size', method: 'GET', endpoint: '/lol-platform-config/v1/namespaces/GameInvites/InviteBulkMaxSize'},
    {label: 'Open Party Enabled', method: 'GET', endpoint: '/lol-platform-config/v1/namespaces/Parties/OpenPartyEnable'},
    {label: 'Discord Rich Presence Enabled', method: 'GET', endpoint: '/lol-platform-config/v1/namespaces/DiscordRP/IsEnabled'},
    {label: 'DANGEROUS MANUAL: Generate Lobby Smart URL', method: 'POST', endpoint: '/lol-lobby/v2/ags/{activityId}/joinCode', body: '{}'},
    {label: 'DANGEROUS MANUAL: League Lobby Invite', method: 'POST', endpoint: '/lol-lobby/v2/lobby/invitations', body: '[\n  {\n    "toSummonerId": "replace-with-target-summoner-id"\n  }\n]'},
    {label: 'DANGEROUS MANUAL: Discord Invite With Context', method: 'POST', endpoint: '/lol-lobby/v2/lobby/invitationsWithContext', body: '[\n  {\n    "puuid": "replace-with-target-puuid",\n    "inviteContext": "DISCORD"\n  }\n]'},
    {label: 'DANGEROUS MANUAL: Unfriend By Chat Friend Id', method: 'DELETE', endpoint: '/lol-chat/v1/friends/{id}', body: '{}'},
    {label: 'Current Regalia', method: 'GET', endpoint: '/lol-regalia/v2/current-summoner/regalia'},
    {label: 'Challenge Summary', method: 'GET', endpoint: '/lol-challenges/v1/summary-player-data/local-player'},
    {label: 'Friend Hovercard', method: 'GET', endpoint: '/lol-hovercard/v1/friend-info/{puuid}'}
  ];
  public selectedPreset = '';
  public method = "GET";
  public body = "{\n     \"\":\"\"\n}";
  public response: string;
  public endPoint: string;
  public requestLoading = false;
  private readonly sensitiveKeys = [
    'access',
    'auth',
    'authorization',
    'code',
    'cookie',
    'displayname',
    'discordid',
    'entitlement',
    'gamename',
    'gametag',
    'id',
    'idtoken',
    'invitation',
    'join',
    'jwt',
    'link',
    'name',
    'note',
    'password',
    'pid',
    'puuid',
    'refresh',
    'secret',
    'session',
    'statusmessage',
    'summary',
    'summoner',
    'token',
    'url'
  ];

  constructor(private lcuConnectionService: LCUConnectionService) {
  }

  public applyPreset(endpoint: string): void {
    const preset = this.endpointPresets.find(item => item.endpoint === endpoint);
    if (!preset) return;
    this.method = preset.method;
    this.endPoint = preset.endpoint;
    if (this.method === 'GET') return;
    this.body = preset.body || "{\n     \"\":\"\"\n}";
  }

  public sendRequest(): void {
    if (this.requestLoading) return;
    const endpoint = (this.endPoint || '').trim();
    if (!this.method || !endpoint) {
      this.response = 'Select a method and enter an endpoint.';
      return;
    }
    if (endpoint.charAt(0) !== '/') {
      this.response = 'Endpoint must start with /.';
      return;
    }

    let body: Record<string, unknown> = {};
    if (this.method !== 'GET') {
      try {
        body = JSON.parse(this.body || '{}');
      } catch (error) {
        this.response = 'Invalid JSON Format';
        return;
      }
    }
    this.requestLoading = true;
    this.response = 'Sending request...';
    this.lcuConnectionService.requestCustomAPI(body, this.method, endpoint)
      .then(response => {
        this.response = this.formatResponse(response);
      })
      .catch(error => {
        this.response = this.formatResponse(error && (error.message || error));
      })
      .finally(() => {
        this.requestLoading = false;
      });
  }

  private formatResponse(response: any): string {
    if (typeof response !== 'string') return JSON.stringify(this.redact(response), null, 3);
    try {
      return JSON.stringify(this.redact(JSON.parse(response)), null, 3);
    } catch (error) {
      return this.redactText(response);
    }
  }

  private redact(value: any, key = ''): any {
    if (this.isSensitiveKey(key)) return '[REDACTED]';
    if (typeof value === 'string') return this.isSensitiveString(value) ? '[REDACTED]' : value;
    if (Array.isArray(value)) return value.map(item => this.redact(item, key));
    if (value && typeof value === 'object') {
      const output = {};
      Object.keys(value).forEach(childKey => {
        output[childKey] = this.redact(value[childKey], childKey);
      });
      return output;
    }
    return value;
  }

  private isSensitiveKey(key: string): boolean {
    const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return this.sensitiveKeys.some(value => normalized.indexOf(value) >= 0) ||
      normalized.endsWith('id') ||
      normalized.endsWith('ids');
  }

  private isSensitiveString(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed.length < 1) return false;
    if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/.test(trimmed)) return true;
    if (/join.?code|access.?token|refresh.?token|id.?token|authorization|cookie/i.test(trimmed)) return true;
    return /^[A-Za-z0-9_-]{24,}$/.test(trimmed) && /[A-Za-z]/.test(trimmed) && /\d/.test(trimmed);
  }

  private redactText(value: string): string {
    return String(value || '')
      .replace(/[A-Za-z0-9_-]{20,}.[A-Za-z0-9_-]{20,}.[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
      .replace(/(access_token|refresh_token|id_token|joinCode|join_code|authorization|cookie)([=:]\s*)([^\s&"]+)/gi, '$1$2[REDACTED]');
  }

}
