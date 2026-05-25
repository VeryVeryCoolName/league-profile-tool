import {Component} from '@angular/core';
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";

@Component({
  selector: 'app-lcu-explorer',
  templateUrl: './lcu-explorer.component.html',
  styleUrls: ['./lcu-explorer.component.css']
})
export class LcuExplorerComponent {
  public query = '';
  public selectedEndpoint = '/lol-challenges/v1/client-state';
  public loading = false;
  public response = '';
  public endpoints = [
    {method: 'GET', path: '/lol-challenges/v1/client-state', notes: 'Challenge client state'},
    {method: 'GET', path: '/lol-challenges/v1/challenges/local-player', notes: 'Local challenge progress'},
    {method: 'GET', path: '/lol-challenges/v1/summary-player-data/local-player', notes: 'Local challenge summary'},
    {method: 'GET', path: '/lol-challenges/v1/challenges/category-data', notes: 'Challenge categories'},
    {method: 'GET', path: '/lol-challenges/v1/level-points', notes: 'Challenge crystal points'},
    {method: 'GET', path: '/lol-challenges/v1/seasons', notes: 'Challenge seasons'},
    {method: 'GET', path: '/lol-challenges/v2/titles/all', notes: 'All known titles'},
    {method: 'GET', path: '/lol-challenges/v2/titles/local-player', notes: 'Unlocked local player titles'},
    {method: 'GET', path: '/lol-lobby/v2/lobby', notes: 'Current lobby state'},
    {method: 'GET', path: '/lol-gameflow/v1/gameflow-phase', notes: 'Current gameflow phase'},
    {method: 'GET', path: '/lol-summoner/v1/current-summoner/summoner-profile', notes: 'Profile background/showcase data'},
    {method: 'GET', path: '/lol-summoner/v1/current-summoner', notes: 'Current summoner identity'}
  ];

  constructor(private lcuConnectionService: LCUConnectionService) {
  }

  public get filteredEndpoints() {
    const search = this.query.toLowerCase();
    return this.endpoints.filter(endpoint => {
      return endpoint.path.toLowerCase().indexOf(search) >= 0 || endpoint.notes.toLowerCase().indexOf(search) >= 0;
    });
  }

  public refresh(endpoint: string = this.selectedEndpoint) {
    this.selectedEndpoint = endpoint;
    this.loading = true;
    this.response = '';
    this.lcuConnectionService.requestCustomAPI({}, 'GET', endpoint)
      .then(response => {
        this.loading = false;
        this.response = this.formatResponse(response);
      });
  }

  private formatResponse(response: any): string {
    if (typeof response !== 'string') return JSON.stringify(response, null, 2);
    try {
      return JSON.stringify(JSON.parse(response), null, 2);
    } catch (err) {
      return response;
    }
  }
}
