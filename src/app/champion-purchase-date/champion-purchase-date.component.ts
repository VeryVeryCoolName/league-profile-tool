import {Component, OnInit} from '@angular/core';
import {Sort} from '@angular/material/sort';
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";
import {VersionService} from "../core/services/version/version.service";


@Component({
    selector: 'app-champion-purchase-date',
    templateUrl: './champion-purchase-date.component.html',
    styleUrls: ['./champion-purchase-date.component.css'],
    standalone: false
})
export class ChampionPurchaseDateComponent implements OnInit {
  public ownedChamps = null;
  public ownershipLoading = true;
  public ownershipError = '';
  public showingSkins = false;
  public searchText: string;
  public sortedData = [];
  public currentVersion = '';
  private championData = [];
  private championAliasOverrides: Record<string, string> = {
    FiddleSticks: 'Fiddlesticks'
  };

  constructor(private lcuConnectionService: LCUConnectionService, private version: VersionService) {
  }

  ngOnInit(): void {
    this.version.apiVersion().subscribe((v: string[]) => {
      this.currentVersion = v[0];
      this.getOwnership();
    }, error => {
      console.error('[Assets] failed to load Data Dragon version', error);
      this.failOwnership('Could not load the current Data Dragon version.');
    });
  }

  public sortData(sort: Sort): void {
    const data = this.championData.slice();
    if (!sort.active || sort.direction === '') {
      this.sortedData = data;
      return;
    }
    this.sortedData = data.sort((a, b) => {
      const isAsc = sort.direction === 'asc';
      switch (sort.active) {
        case 'name':
          return compare(a.name.toLowerCase(), b.name.toLowerCase(), isAsc);
        case 'purchased':
          return compare(a.purchasedHidden, b.purchasedHidden, isAsc);
        default:
          return 0;
      }
    });
  }

  public showSkins(champion: Record<string, unknown>): void {
    this.showingSkins = true;
    this.championData = [];
    this.championData.push({
      name: champion.alt,
      purchased: champion.purchased,
      purchasedHidden: champion.purchasedHidden
    });
    const skins = (champion.skins || []) as Array<Record<string, unknown>>;
    for (let i = 0; i < skins.length; i++) {
      this.championData.push({
        name: skins[i].name,
        purchased: skins[i].purchased,
        purchasedHidden: skins[i].purchasedHidden
      });
    }
    this.sortedData = this.championData.slice();
  }

  private getOwnership() {
    this.ownedChamps = [];
    this.ownershipLoading = true;
    this.ownershipError = '';
    this.lcuConnectionService.requestCustomAPI({}, 'GET', '/lol-summoner/v1/current-summoner').then(response => {
      const summoner = this.parseResponse(response);
      if (!summoner || !summoner.summonerId) {
        this.failOwnership('Could not load the current summoner from LCU.');
        return;
      }

      this.lcuConnectionService.requestCustomAPI({}, 'GET', `/lol-champions/v1/inventories/${String(summoner.summonerId)}/champions`).then(ownedC => {
        const champions = this.parseResponse(ownedC);
        if (!Array.isArray(champions)) {
          this.failOwnership('Could not load champion ownership from LCU.');
          return;
        }

        const ownedChamps = [];
        for (let i = 0; i < champions.length; i++) {
          if (champions[i].ownership.owned) {
            const o = {
              alt: this.getDataDragonAlias(champions[i].alias),
              purchased: new Date(champions[i].purchased).toLocaleString("en-US"),
              purchasedHidden: champions[i].purchased,
              skins: [],
              iconSrc: ''
            };
            o.iconSrc = `https://ddragon.leagueoflegends.com/cdn/${this.currentVersion}/img/champion/${o.alt}.png`;
            for (let j = 1; j < champions[i].skins.length; j++) {
              if (champions[i].skins[j].ownership.owned) {
                o.skins.push({
                  name: champions[i].skins[j].name,
                  purchased: new Date(champions[i].skins[j].ownership.rental.purchaseDate).toLocaleString("en-US"),
                  purchasedHidden: champions[i].skins[j].ownership.rental.purchaseDate
                });
              }
            }
            ownedChamps.push(o);
          }
        }
        this.ownedChamps = ownedChamps.sort((a, b) => {
          return compare(a.purchasedHidden, b.purchasedHidden, true);
        });
        this.ownershipLoading = false;
      });
    });
  }

  private getDataDragonAlias(alias: string): string {
    return this.championAliasOverrides[alias] || alias;
  }

  private parseResponse(response: any): any {
    if (typeof response !== 'string') return response;
    try {
      return JSON.parse(response);
    } catch (err) {
      console.error('[LCU] failed to parse champion ownership response', response);
      return null;
    }
  }

  private failOwnership(message: string) {
    this.ownedChamps = [];
    this.ownershipLoading = false;
    this.ownershipError = message;
  }

  public trackByChampion(index: number, champion: Record<string, unknown>): unknown {
    return champion.alt;
  }

  public trackByPurchaseRow(index: number, champion: Record<string, unknown>): string {
    return `${String(champion.name)}-${String(champion.purchasedHidden)}`;
  }
}

function compare(a: number | string, b: number | string, isAsc: boolean) {
  return (a < b ? -1 : 1) * (isAsc ? 1 : -1);
}
