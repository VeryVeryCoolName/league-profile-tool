import { Injectable } from '@angular/core';
import { HttpClient } from "@angular/common/http";
import {Observable} from "rxjs";
import {timeout} from "rxjs/operators";

@Injectable({
  providedIn: 'root'
})
export class VersionService {
  private readonly githubVersionUrls = [
    'https://api.github.com/repos/VeryVeryCoolName/league-profile-tool/releases/latest',
    'https://raw.githubusercontent.com/VeryVeryCoolName/league-profile-tool/main/package.json',
    'https://raw.githubusercontent.com/VeryVeryCoolName/league-profile-tool/master/package.json',
    'https://raw.githubusercontent.com/VeryVeryCoolName/league-profile-tool/main/version.json',
    'https://raw.githubusercontent.com/VeryVeryCoolName/league-profile-tool/master/version.json'
  ];

  constructor(private http: HttpClient) {
  }

  apiVersion(): Observable<any> {
    return this.http.get("https://ddragon.leagueoflegends.com/api/versions.json");
  }

  async latestGithubVersion(): Promise<string> {
    for (const url of this.githubVersionUrls) {
      try {
        const response = await this.http.get(url).pipe(timeout(2500)).toPromise();
        const version = this.extractVersion(response);
        if (version) return version;
      } catch (error) {
        continue;
      }
    }

    throw new Error('Could not check GitHub version.');
  }

  private extractVersion(response: any): string {
    if (!response) return '';
    if (typeof response === 'string') return this.findVersion(response);

    const candidate = response.version || response.tag_name || response.name;
    if (candidate) return this.findVersion(String(candidate));

    return '';
  }

  private findVersion(value: string): string {
    const match = /v?\.?(\d+\.\d+\.\d+)/i.exec(value);
    return match ? match[1] : '';
  }
}
