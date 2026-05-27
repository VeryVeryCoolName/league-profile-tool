import {Component, OnInit} from '@angular/core';
import {ElectronService} from "../core/services";
import {VersionService} from "../core/services/version/version.service";

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {
  public title = 'LEAGUE PROFILE TOOL';
  public currentVersion = 'V.3.1.0';
  public newestVersion = 'Checking...';
  public updateCheckStatus = 'Checking GitHub for updates.';

  constructor(private electronService: ElectronService, private versionService: VersionService) {
  }

  ngOnInit() {
    setTimeout(() => this.checkNewestVersion(), 0);
  }

  private async checkNewestVersion() {
    try {
      const newestVersion = await this.versionService.latestGithubVersion();
      this.newestVersion = this.formatVersion(newestVersion);
      this.updateCheckStatus = this.newestVersion === this.currentVersion
        ? 'You are up to date.'
        : 'Update available on GitHub.';
    } catch (error){
      this.newestVersion = 'Unavailable';
      this.updateCheckStatus = 'Could not check GitHub updates.';
    }
  }

  private formatVersion(version: string): string {
    const normalized = (version || '').trim().replace(/^v\.?/i, '');
    return normalized ? `V.${normalized}` : 'Unavailable';
  }

  public github() {
    const url = 'https://github.com/VeryVeryCoolName/league-profile-tool';
    if (this.electronService.shell) {
      this.electronService.shell.openExternal(url);
      return;
    }
    window.open(url, '_blank');
  }
}
