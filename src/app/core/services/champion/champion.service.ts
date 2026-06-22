import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {Observable, shareReplay} from 'rxjs';

export interface ChampionManifest {
  data: Record<string, {
    key: string;
    [key: string]: unknown;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class ChampionService {
  private readonly championRequests = new Map<string, Observable<ChampionManifest>>();
  private readonly skinRequests = new Map<string, Observable<any>>();
  private summonerIconsRequest: Observable<any[]> | null = null;
  private skinCatalogRequest: Observable<Record<string, any>> | null = null;

  constructor(private http: HttpClient) { }

  getChampionIcons(version: string): Observable<ChampionManifest> {
    if (!this.championRequests.has(version)) {
      this.championRequests.set(
        version,
        this.http
          .get<ChampionManifest>(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`)
          .pipe(shareReplay({bufferSize: 1, refCount: false}))
      );
    }
    return this.championRequests.get(version);
  }

  getSkins(version: string, alt: string): Observable<any> {
    const key = `${version}:${alt}`;
    if (!this.skinRequests.has(key)) {
      this.skinRequests.set(
        key,
        this.http
          .get<any>(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion/${alt}.json`)
          .pipe(shareReplay({bufferSize: 1, refCount: false}))
      );
    }
    return this.skinRequests.get(key);
  }

  getSkinCatalog(): Observable<Record<string, any>> {
    if (!this.skinCatalogRequest) {
      this.skinCatalogRequest = this.http
        .get<Record<string, any>>('https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/skins.json')
        .pipe(shareReplay({bufferSize: 1, refCount: false}));
    }
    return this.skinCatalogRequest;
  }

  getSummonerIcons(): Observable<any[]> {
    if (!this.summonerIconsRequest) {
      this.summonerIconsRequest = this.http
        .get<any[]>('https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/summoner-icons.json')
        .pipe(shareReplay({bufferSize: 1, refCount: false}));
    }
    return this.summonerIconsRequest;
  }
}
