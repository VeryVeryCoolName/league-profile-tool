import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {catchError, forkJoin, map, Observable, of, shareReplay, switchMap, tap, throwError} from 'rxjs';
import {CLASSIC_DATA_BRANCHES, isClassicChampionKey} from '../../classic';
import {CN_EXCLUSIVE_SUMMONER_ICONS, CN_ICON_BRANCH, isCnExclusiveIconId} from '../../cn-icons';
import {COMMUNITY_DRAGON_BRANCHES, COMMUNITY_DRAGON_LIVE_BRANCH, communityDragonUrl} from '../../community-dragon';

export interface ChampionManifest {
  data: Record<string, {
    key: string;
    [key: string]: unknown;
  }>;
}

export interface ClassicChampionData {
  branch: string;
  champions: any[];
}

export interface ClassicChampionDetail {
  branch: string;
  champion: any;
}

@Injectable({
  providedIn: 'root'
})
export class ChampionService {
  private readonly championRequests = new Map<string, Observable<ChampionManifest>>();
  private readonly skinRequests = new Map<string, Observable<any>>();
  private readonly summonerIconsRequests = new Map<string, Observable<any[]>>();
  private allSummonerIconsRequest: Observable<any[]> | null = null;
  private skinCatalogRequest: Observable<Record<string, any>> | null = null;
  private classicChampionDataRequest: Observable<ClassicChampionData> | null = null;
  private readonly classicChampionDetailRequests = new Map<number, Observable<ClassicChampionDetail>>();

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
        .get<Record<string, any>>(communityDragonUrl('latest', 'v1/skins.json'))
        .pipe(shareReplay({bufferSize: 1, refCount: false}));
    }
    return this.skinCatalogRequest;
  }

  getClassicChampionData(): Observable<ClassicChampionData> {
    if (!this.classicChampionDataRequest) {
      this.classicChampionDataRequest = this.resolveClassicChampionData(0).pipe(
        tap(data => {
          if (!data.champions.length) this.classicChampionDataRequest = null;
        }),
        shareReplay({bufferSize: 1, refCount: false})
      );
    }
    return this.classicChampionDataRequest;
  }

  getClassicChampionDetail(championId: number): Observable<ClassicChampionDetail> {
    if (!this.classicChampionDetailRequests.has(championId)) {
      this.classicChampionDetailRequests.set(
        championId,
        this.getClassicChampionData().pipe(
          switchMap(data => this.http
            .get<any>(communityDragonUrl(data.branch, `v1/champions/${championId}.json`))
            .pipe(map(champion => ({branch: data.branch, champion})))),
          catchError(error => {
            this.classicChampionDetailRequests.delete(championId);
            return throwError(() => error);
          }),
          shareReplay({bufferSize: 1, refCount: false})
        )
      );
    }
    return this.classicChampionDetailRequests.get(championId);
  }

  getSummonerIcons(branch: string = COMMUNITY_DRAGON_LIVE_BRANCH): Observable<any[]> {
    if (!this.summonerIconsRequests.has(branch)) {
      this.summonerIconsRequests.set(
        branch,
        this.http
          .get<any[]>(communityDragonUrl(branch, 'v1/summoner-icons.json'))
          .pipe(shareReplay({bufferSize: 1, refCount: false}))
      );
    }
    return this.summonerIconsRequests.get(branch);
  }

  getAllSummonerIcons(): Observable<any[]> {
    if (!this.allSummonerIconsRequest) {
      this.allSummonerIconsRequest = forkJoin(
        COMMUNITY_DRAGON_BRANCHES.map(branch => this.getSummonerIcons(branch).pipe(catchError(() => of([]))))
      ).pipe(
        map(iconsByBranch => {
          const seen = new Set<number>();
          const merged: any[] = [];
          iconsByBranch.forEach((icons, index) => {
            const branch = COMMUNITY_DRAGON_BRANCHES[index];
            (icons || []).forEach(icon => {
              const id = Number(icon && icon.id);
              if (isNaN(id) || seen.has(id)) return;
              seen.add(id);
              merged.push({...icon, branch, cnExclusive: isCnExclusiveIconId(id)});
            });
          });
          CN_EXCLUSIVE_SUMMONER_ICONS.forEach(icon => {
            if (seen.has(icon.id)) return;
            seen.add(icon.id);
            merged.push({id: icon.id, title: icon.title, branch: CN_ICON_BRANCH, cnExclusive: true});
          });
          return merged;
        }),
        shareReplay({bufferSize: 1, refCount: false})
      );
    }
    return this.allSummonerIconsRequest;
  }

  private resolveClassicChampionData(branchIndex: number): Observable<ClassicChampionData> {
    const branch = CLASSIC_DATA_BRANCHES[Math.min(branchIndex, CLASSIC_DATA_BRANCHES.length - 1)];
    if (branchIndex >= CLASSIC_DATA_BRANCHES.length) return of({branch, champions: []});

    return this.http.get<any[]>(communityDragonUrl(branch, 'v1/champion-summary.json')).pipe(
      map(summary => ({
        branch,
        champions: (summary || []).filter(champion => isClassicChampionKey(Number(champion && champion.id)))
      })),
      catchError(() => of({branch, champions: []})),
      switchMap(data => data.champions.length ? of(data) : this.resolveClassicChampionData(branchIndex + 1))
    );
  }
}
