import {Component, ChangeDetectionStrategy, OnDestroy, OnInit} from '@angular/core';
import {Subscription} from "rxjs";
import {ConnectorService} from "./core/services/connector/connector.service";
import {ClientInstallInfo} from "./core/services";
import {Title} from "@angular/platform-browser";
import {APP_WINDOW_TITLE} from "./app-version";

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class AppComponent implements OnInit, OnDestroy {
  public readonly connected$ = this.connector.ready$;
  public installs: ClientInstallInfo[] = [];
  public activePath = '';
  public switching = false;
  public clientPathError = '';
  private readySubscription: Subscription | null = null;
  private installPathSubscription: Subscription | null = null;

  constructor(public connector: ConnectorService, private titleService: Title) {
    this.titleService.setTitle(APP_WINDOW_TITLE);
  }

  public ngOnInit(): void {
    this.installPathSubscription = this.connector.installPath$.subscribe(path => {
      this.activePath = path;
    });
    this.readySubscription = this.connector.ready$.subscribe(() => void this.refreshInstalls());
  }

  public ngOnDestroy(): void {
    this.readySubscription?.unsubscribe();
    this.installPathSubscription?.unsubscribe();
  }

  public get otherInstalls(): ClientInstallInfo[] {
    return this.installs.filter(install => install.path !== this.activePath);
  }

  public get activeInstall(): ClientInstallInfo | undefined {
    return this.installs.find(install => install.path === this.activePath);
  }

  public async selectInstall(install: ClientInstallInfo): Promise<void> {
    await this.switchTo(() => this.connector.selectClientPath(install.path));
  }

  public async browseForInstall(): Promise<void> {
    await this.switchTo(() => this.connector.chooseClientPath());
  }

  private async switchTo(action: () => Promise<string>): Promise<void> {
    if (this.switching) return;

    this.switching = true;
    this.clientPathError = '';
    try {
      await action();
    } catch (error) {
      this.clientPathError = error instanceof Error
        ? error.message
        : 'Select the folder that contains LeagueClient.exe.';
    } finally {
      this.switching = false;
      await this.refreshInstalls();
    }
  }

  private async refreshInstalls(): Promise<void> {
    try {
      this.installs = await this.connector.listClientPaths();
    } catch {
      this.installs = [];
    }
  }
}
