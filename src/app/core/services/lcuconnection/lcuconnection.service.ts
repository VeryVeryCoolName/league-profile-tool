import { Injectable } from '@angular/core';
import {ConnectorService} from "../connector/connector.service";
import {ElectronService} from "..";
import { endpoints } from "./endpoints";

@Injectable({
  providedIn: 'root'
})
export class LCUConnectionService {
  private readonly _endpoints = endpoints;
  constructor(private connector: ConnectorService, private electronService: ElectronService) {
  }

  public async requestSend(body: Record<string, unknown>, method: string, endpoint: string): Promise<any> {
    const endPoint = this._endpoints[endpoint];
    const requestBody = await this.prepareRequestBody(body, method, endpoint, endPoint);
    if (typeof requestBody === 'string') return requestBody;
    const response = await this.makeRequest(method, requestBody, endPoint, false);
    if (response !== 'Success') return response;
    return await this.verifyWrite(body, requestBody, method, endpoint, endPoint);
  }

  public async requestCustomAPI(body: Record<string, unknown>, method: string, endpoint: string): Promise<any> {
    return await this.makeRequest(method, body, endpoint, true);
  }

  private async makeRequest(method: string, body: Record<string, unknown>, endPoint: string, getFull: boolean): Promise<any> {
    if (!this.connector.connector) {
      const message = 'LCU connection is not ready yet.';
      console.error(`[LCU] ${message}`);
      return message;
    }
    const options = JSON.parse(JSON.stringify(this.connector.connector));
    options.url += endPoint;
    options.method = method;
    options.headers = options.headers || {};
    options.headers.Accept = "application/json";
    options.headers["Content-Type"] = "application/json";
    if (method !== 'GET') {
      options.body = JSON.stringify(body);
    }
    return await this.electronService.request(options)
      .then(response => {
        if (!getFull) return 'Success';
        return response;
      })
      .catch(err => {
        const message = this.formatError(err);
        console.error(`[LCU] ${method} ${endPoint} failed`, message);
        if (method !== 'GET') {
          return `${method} ${endPoint} failed: ${message}. Payload: ${this.summarizePayload(body)}`;
        }
        return message;
      });
  }

  private async prepareRequestBody(body: Record<string, unknown>, method: string, endpoint: string, endPoint: string): Promise<any> {
    if (endpoint === 'lolChat' && method === 'PUT' && body.lol) {
      const response = await this.makeRequest('GET', {}, endPoint, true);
      const current = this.parseResponse(response);
      if (!current) return response;
      const requestBody = {...body};
      if (body.lol) {
        const currentLol = (current.lol || {}) as Record<string, unknown>;
        const nextLol = body.lol as Record<string, unknown>;
        requestBody.lol = {
          ...currentLol,
          ...nextLol
        };
      }
      return requestBody;
    }

    if (endpoint === 'profile' && method === 'POST' && body.key === 'backgroundSkinId') {
      const response = await this.makeRequest('GET', {}, endPoint, true);
      const current = this.parseResponse(response);
      if (!current) return response;
      if (!Object.prototype.hasOwnProperty.call(current, 'backgroundSkinId')) {
        console.error('[LCU] Summoner profile schema mismatch', current);
        return 'LCU summoner profile response did not include backgroundSkinId.';
      }
    }

    return body;
  }

  private async verifyWrite(expectedBody: Record<string, unknown>, requestBody: Record<string, unknown>, method: string, endpoint: string, endPoint: string): Promise<string> {
    if (method === 'GET') return 'Success';

    if (endpoint === 'lolChat') {
      return await this.verifyWithRetry(endPoint, expectedBody, requestBody, endPoint);
    }

    if (endpoint === 'profile' && expectedBody.key === 'backgroundSkinId') {
      return await this.verifyWithRetry(endPoint, {backgroundSkinId: expectedBody.value}, requestBody, endPoint);
    }

    return 'Success';
  }

  private parseResponse(response: any): Record<string, unknown> {
    if (typeof response === 'string') {
      try {
        return JSON.parse(response);
      } catch (err) {
        console.error('[LCU] Failed to parse response', response);
        return null;
      }
    }
    return response || {};
  }

  private async verifyWithRetry(getEndPoint: string, expected: Record<string, unknown>, requestBody: Record<string, unknown>, writeEndPoint: string): Promise<string> {
    let current = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.delay(500);
      const response = await this.makeRequest('GET', {}, getEndPoint, true);
      current = this.parseResponse(response);
      if (!current) return response;
      if (this.matchesPatch(current, expected)) return 'Success';
    }
    return this.verificationFailed(writeEndPoint, requestBody, current, expected);
  }

  private matchesPatch(current: Record<string, unknown>, patch: Record<string, unknown>): boolean {
    return Object.keys(patch).every(key => {
      const expected = patch[key];
      const actual = current[key];
      if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        if (!actual || typeof actual !== 'object') return false;
        return this.matchesPatch(actual as Record<string, unknown>, expected as Record<string, unknown>);
      }
      return this.valuesMatch(key, actual, expected);
    });
  }

  private valuesMatch(key: string, actual: unknown, expected: unknown): boolean {
    if (typeof actual === 'string' && typeof expected === 'string' && this.shouldNormalizeCase(key)) {
      return actual.toUpperCase() === expected.toUpperCase();
    }
    return actual === expected;
  }

  private shouldNormalizeCase(key: string): boolean {
    return ['rank', 'queue', 'division', 'rankedLeagueTier', 'rankedLeagueQueue', 'rankedLeagueDivision'].indexOf(key) >= 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private verificationFailed(endPoint: string, requestBody: Record<string, unknown>, actual: Record<string, unknown>, expected: Record<string, unknown>): string {
    const message = `LCU update sent, but ${endPoint} did not reflect the requested value.`;
    console.error('[LCU] Verification failed', {endpoint: endPoint, payload: requestBody, expected, actual});
    return `${message} Payload: ${JSON.stringify(requestBody)} Response: ${JSON.stringify(actual)}`;
  }

  private formatError(err: any): string {
    const error = err && (err.error || err.message || err.response && err.response.body || err);
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error);
    } catch (jsonErr) {
      return String(error);
    }
  }

  private summarizePayload(body: Record<string, unknown>): string {
    try {
      return JSON.stringify(body);
    } catch (err) {
      return '[unserializable payload]';
    }
  }

}
