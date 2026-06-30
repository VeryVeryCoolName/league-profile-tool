import {Component, OnDestroy, OnInit, ChangeDetectionStrategy} from '@angular/core';
import {ElectronService} from "../core/services";
import {VersionService} from "../core/services/version/version.service";
import {APP_VERSION_LABEL} from "../app-version";

@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class HomeComponent implements OnInit, OnDestroy {
  public title = 'LEAGUE PROFILE TOOL';
  public currentVersion = APP_VERSION_LABEL;
  public newestVersion = 'Checking...';
  public updateCheckStatus = 'Checking GitHub for updates.';
  private updateCheckTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private electronService: ElectronService, private versionService: VersionService) {
  }

  ngOnInit(): void {
    this.updateCheckTimer = setTimeout(() => {
      void this.checkNewestVersion();
    }, 250);
  }

  ngOnDestroy(): void {
    if (this.updateCheckTimer !== null) clearTimeout(this.updateCheckTimer);
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

  public github(): void {
    const url = 'https://github.com/VeryVeryCoolName/league-profile-tool';
    if (this.electronService.shell) {
      void this.electronService.shell.openExternal(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
