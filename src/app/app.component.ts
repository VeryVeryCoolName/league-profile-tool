import {Component} from '@angular/core';
import {ConnectorService} from "./core/services/connector/connector.service";
import {Title} from "@angular/platform-browser";
import {APP_WINDOW_TITLE} from "./app-version";

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  public readonly connected$ = this.connector.ready$;

  constructor(public connector: ConnectorService, private titleService: Title) {
    this.titleService.setTitle(APP_WINDOW_TITLE);
  }
}
