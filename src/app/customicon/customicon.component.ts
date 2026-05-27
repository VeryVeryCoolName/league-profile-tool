import {Component, OnInit} from '@angular/core';
import {DialogComponent} from "../core/dialog/dialog.component";
import {MatDialog} from "@angular/material/dialog";
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";
import {ChampionService} from "../core/services/champion/champion.service";
import {IdentityPreviewService} from "../core/services/identity-preview/identity-preview.service";

@Component({
  selector: 'app-customicon',
  templateUrl: './customicon.component.html',
  styleUrls: ['./customicon.component.css']
})
export class CustomiconComponent implements OnInit {
  public searchKeyword = '';
  public allIcons: Array<Record<string, unknown>> = [];
  public visibleIconLimit = 200;
  public iconsLoading = true;
  public iconsError = '';

  constructor(public dialog: MatDialog, private lcuConnectionService: LCUConnectionService, private championData: ChampionService, private identityPreviewService: IdentityPreviewService) {
  }

  async ngOnInit() {
    this.championData.getSummonerIcons().subscribe(icons => {
      this.allIcons = (icons as Array<Record<string, unknown>>)
        .filter(icon => icon && icon.id !== undefined && icon.id !== null)
        .sort((left, right) => Number(left.id) - Number(right.id))
        .map(icon => {
          return {
            ...icon,
            src: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${icon.id}.jpg`,
            broken: false
          };
        });
      this.iconsLoading = false;
    }, error => {
      console.error('[Assets] failed to load summoner icons', error);
      this.iconsLoading = false;
      this.iconsError = 'Could not load summoner icons.';
    })
  }

  public get filteredIcons() {
    const search = (this.searchKeyword || '').toLowerCase();
    if (!search) return this.allIcons;
    return this.allIcons.filter(icon => {
      const title = String(icon.title || '').toLowerCase();
      const id = String(icon.id || '');
      return title.indexOf(search) >= 0 || id.indexOf(search) >= 0;
    });
  }

  public get visibleIcons() {
    return this.filteredIcons.slice(0, this.visibleIconLimit);
  }

  public resetIconLimit() {
    this.visibleIconLimit = 200;
  }

  public loadMoreIcons() {
    this.visibleIconLimit += 200;
  }

  public onIconError(icon: Record<string, unknown>) {
    icon.broken = true;
  }

  public setIcon(id: unknown) {
    const iconId = Number(id);
    if (isNaN(iconId)) {
      this.dialog.open(DialogComponent, {
        data: {body: 'Select a valid icon ID.'}
      });
      return;
    }

    const body = {
      icon: iconId
    };
    this.lcuConnectionService.requestSend(body, 'PUT', 'lolChat').then(response => {
      if (response === 'Success') this.identityPreviewService.applyProfileIcon(iconId);
      this.dialog.open(DialogComponent, {
        data: {body: response}
      });
    });
  }

  public trackByIcon(index: number, icon: Record<string, unknown>) {
    return icon.id;
  }

}
