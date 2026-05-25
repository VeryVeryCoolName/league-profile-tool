import {Component} from '@angular/core';
import {ConnectorService} from "./core/services/connector/connector.service";

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  constructor(public connector: ConnectorService) {
  }

  public isConnected(): boolean {
    return this.connector.isReady();
  }
}
