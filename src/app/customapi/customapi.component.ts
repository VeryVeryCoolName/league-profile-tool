import {Component} from '@angular/core';
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";

@Component({
  selector: 'app-customapi',
  templateUrl: './customapi.component.html',
  styleUrls: ['./customapi.component.css']
})
export class CustomapiComponent {
  public methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  public endpointPresets = [
    {label: 'Current Summoner', method: 'GET', endpoint: '/lol-summoner/v1/current-summoner'},
    {label: 'Chat Presence', method: 'GET', endpoint: '/lol-chat/v1/me'},
    {label: 'Gameflow Phase', method: 'GET', endpoint: '/lol-gameflow/v1/gameflow-phase'},
    {label: 'Current Lobby', method: 'GET', endpoint: '/lol-lobby/v2/lobby'},
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

  constructor(private lcuConnectionService: LCUConnectionService) {
  }

  public applyPreset(endpoint: string): void {
    const preset = this.endpointPresets.find(item => item.endpoint === endpoint);
    if (!preset) return;
    this.method = preset.method;
    this.endPoint = preset.endpoint;
    if (this.method === 'GET') return;
    this.body = "{\n     \"\":\"\"\n}";
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
    if (typeof response !== 'string') return JSON.stringify(response, null, 3);
    try {
      return JSON.stringify(JSON.parse(response), null, 3);
    } catch (error) {
      return response;
    }
  }

}
