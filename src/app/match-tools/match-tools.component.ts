import {Component} from '@angular/core';
import {MatchToolsService} from '../core/services/match-tools/match-tools.service';
import {ElectronService} from '../core/services/electron/electron.service';

@Component({
    selector: 'app-match-tools',
    templateUrl: './match-tools.component.html',
    styleUrls: ['./match-tools.component.css'],
    standalone: false
})
export class MatchToolsComponent {
  public state$ = this.matchToolsService.state$;
  public providers = this.matchToolsService.matchupProviders;

  constructor(
    private matchToolsService: MatchToolsService,
    private electronService: ElectronService
  ) {
  }

  public toggleAutoAccept(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.matchToolsService.setAutoAccept(input.checked);
  }

  public setProvider(providerId: string): void {
    this.matchToolsService.setProvider(providerId);
  }

  public selectOpponent(championId: number): void {
    this.matchToolsService.selectManualOpponent(championId);
  }

  public clearOpponent(): void {
    this.matchToolsService.clearManualOpponent();
  }

  public openExternal(url: string): void {
    if (!url) return;
    if (this.electronService.isElectron && this.electronService.shell) {
      this.electronService.shell.openExternal(url);
      return;
    }

    window.open(url, '_blank', 'noopener');
  }
}
