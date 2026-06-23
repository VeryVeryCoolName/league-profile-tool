import {Component, ChangeDetectionStrategy} from '@angular/core';
import {ConnectorService} from "./core/services/connector/connector.service";
import {Title} from "@angular/platform-browser";
import {APP_WINDOW_TITLE} from "./app-version";

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class AppComponent {
  public readonly connected$ = this.connector.ready$;
  public choosingClientPath = false;
  public clientPathError = '';

  constructor(public connector: ConnectorService, private titleService: Title) {
    this.titleService.setTitle(APP_WINDOW_TITLE);
  }

  public async chooseClientPath(): Promise<void> {
    if (this.choosingClientPath) return;

    this.choosingClientPath = true;
    this.clientPathError = '';
    try {
      await this.connector.chooseClientPath();
    } catch (error) {
      this.clientPathError = error instanceof Error
        ? error.message
        : 'Selected folder does not look like a League of Legends install.';
    } finally {
      this.choosingClientPath = false;
    }
  }
}
