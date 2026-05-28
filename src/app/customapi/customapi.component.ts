import {Component} from '@angular/core';
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";

@Component({
  selector: 'app-customapi',
  templateUrl: './customapi.component.html',
  styleUrls: ['./customapi.component.css']
})
export class CustomapiComponent {
  public methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  public method = "GET";
  public body = "{\n     \"\":\"\"\n}";
  public response: string;
  public endPoint: string;

  constructor(private lcuConnectionService: LCUConnectionService) {
  }

  public sendRequest() {
    const endpoint = (this.endPoint || '').trim();
    if (!this.method || !endpoint) {
      this.response = 'Select a method and enter an endpoint.';
      return;
    }
    if (endpoint.charAt(0) !== '/') {
      this.response = 'Endpoint must start with /.';
      return;
    }

    let body: Record<string, unknown> = {};
    if (this.method !== 'GET') {
      try {
        body = JSON.parse(this.body || '{}');
      } catch (error) {
        this.response = 'Invalid JSON Format';
        return;
      }
    }
    this.lcuConnectionService.requestCustomAPI(body, this.method, endpoint).then(response => {
      this.response = this.formatResponse(response);
    });
  }

  private formatResponse(response: any): string {
    if (typeof response !== 'string') return JSON.stringify(response, null, 3);
    try {
      return JSON.stringify(JSON.parse(response), null, 3);
    } catch (error) {
      return response;
    }
  }

}
