import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {firstValueFrom, Observable, shareReplay} from 'rxjs';
import {timeout} from 'rxjs/operators';

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
  private readonly dataDragonVersions = this.http
    .get<string[]>('https://ddragon.leagueoflegends.com/api/versions.json')
    .pipe(shareReplay({bufferSize: 1, refCount: false}));
  private latestVersionPromise: Promise<string> | null = null;

  constructor(private http: HttpClient) {
  }

  apiVersion(): Observable<string[]> {
    return this.dataDragonVersions;
  }

  async latestGithubVersion(): Promise<string> {
    if (this.latestVersionPromise !== null) return this.latestVersionPromise;
    this.latestVersionPromise = this.fetchLatestGithubVersion().catch(error => {
      this.latestVersionPromise = null;
      throw error;
    });
    return this.latestVersionPromise;
  }

  private async fetchLatestGithubVersion(): Promise<string> {
    for (const url of this.githubVersionUrls) {
      try {
        const response = await firstValueFrom(this.http.get(url).pipe(timeout(2500)));
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
