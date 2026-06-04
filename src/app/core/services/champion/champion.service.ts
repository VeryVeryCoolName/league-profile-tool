import { Injectable } from '@angular/core';
import {HttpClient} from "@angular/common/http";
import {Observable} from "rxjs";

@Injectable({
  providedIn: 'root'
})
export class ChampionService {

  constructor(private http: HttpClient) { }

  getChampionIcons(version: string): Observable<any> {
    return this.http.get(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`);
  }

  getSkins(version: string, alt: string): Observable<any> {
    return this.http.get(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion/${alt}.json`);
  }

  getSummonerIcons(): Observable<any> {
    return this.http.get("https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/summoner-icons.json");
  }
}
