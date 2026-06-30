import { Injectable } from '@angular/core';
import {ConnectorService} from "../connector/connector.service";
import {ElectronService} from "..";
import { endpoints } from "./endpoints";

@Injectable({
  providedIn: 'root'
})
export class LCUConnectionService {
  private readonly _endpoints = endpoints;
  private readonly inFlightGetRequests = new Map<string, Promise<any>>();
  constructor(private connector: ConnectorService, private electronService: ElectronService) {
  }

  public async requestSend(body: Record<string, unknown>, method: string, endpoint: string): Promise<any> {
    const requestMethod = this.normalizeMethod(method);
    const endPoint = this._endpoints[endpoint];
    const requestBody = await this.prepareRequestBody(body, requestMethod, endpoint, endPoint);
    if (typeof requestBody === 'string') return requestBody;
    const response = await this.makeRequest(requestMethod, requestBody, endPoint, false);
    if (response !== 'Success') return response;
    return await this.verifyWrite(body, requestBody, requestMethod, endpoint, endPoint);
  }

  public async requestSendNoVerify(body: Record<string, unknown>, method: string, endpoint: string): Promise<any> {
    const requestMethod = this.normalizeMethod(method);
    const endPoint = this._endpoints[endpoint];
    const requestBody = await this.prepareRequestBody(body, requestMethod, endpoint, endPoint);
    if (typeof requestBody === 'string') return requestBody;
    return await this.makeRequest(requestMethod, requestBody, endPoint, false);
  }

  public async requestCustomAPI(body: Record<string, unknown>, method: string, endpoint: string): Promise<any> {
    const requestMethod = this.normalizeMethod(method);
    if (requestMethod === 'GET') {
      const key = this.normalizeEndpoint(endpoint) || endpoint;
      const existing = this.inFlightGetRequests.get(key);
      if (existing !== undefined) return await existing;

      const request = this.makeRequest(requestMethod, body, endpoint, true).finally(() => {
        this.inFlightGetRequests.delete(key);
      });
      this.inFlightGetRequests.set(key, request);
      return await request;
    }

    return await this.makeRequest(requestMethod, body, endpoint, true);
  }

  private async makeRequest(method: string, body: Record<string, unknown>, endPoint: string, getFull: boolean): Promise<any> {
    if (!this.connector.connector) {
      return 'LCU connection is not ready yet.';
    }
    const normalizedEndPoint = this.normalizeEndpoint(endPoint);
    if (!normalizedEndPoint) return 'Invalid LCU endpoint path.';

    const options = JSON.parse(JSON.stringify(this.connector.connector));
    options.url += normalizedEndPoint;
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
        if (this.shouldLogRequestFailure(method, normalizedEndPoint, message)) {
          console.error(`[LCU] ${method} ${normalizedEndPoint} failed`, message);
        }
        if (method !== 'GET') {
          return `${method} ${normalizedEndPoint} failed: ${message}. Payload: ${this.summarizePayload(body)}`;
        }
        return message;
      });
  }

  private normalizeMethod(method: string): string {
    return String(method || 'GET').trim().toUpperCase();
  }

  private normalizeEndpoint(endPoint: string): string {
    const value = String(endPoint || '').trim();
    if (!value || /[\u0000-\u001f\u007f\s\\]/.test(value) || /%(?:2e|2f|5c)/i.test(value)) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return '';
    if (!value.startsWith('/') || value.indexOf('#') >= 0) return '';
    if (
      value !== '/help' &&
      !value.startsWith('/lol-') &&
      !value.startsWith('/plugin-manager/') &&
      !value.startsWith('/riotclient/')
    ) {
      return '';
    }
    return value;
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
        Object.keys(nextLol).forEach(key => {
          if (nextLol[key] === undefined) delete (requestBody.lol as Record<string, unknown>)[key];
        });
      }
      return requestBody;
    }

    if (endpoint === 'profile' && method === 'POST' && body.key) {
      const response = await this.makeRequest('GET', {}, endPoint, true);
      const current = this.parseResponse(response);
      if (!current) return response;
      if (!Object.prototype.hasOwnProperty.call(current, body.key)) {
        console.error('[LCU] Summoner profile schema mismatch', current);
        return `LCU summoner profile response did not include ${String(body.key)}.`;
      }
    }

    return body;
  }

  private async verifyWrite(expectedBody: Record<string, unknown>, requestBody: Record<string, unknown>, method: string, endpoint: string, endPoint: string): Promise<string> {
    if (method === 'GET') return 'Success';

    if (endpoint === 'lolChat') {
      return await this.verifyWithRetry(endPoint, expectedBody, requestBody, endPoint);
    }

    if (endpoint === 'profile' && expectedBody.key) {
      return await this.verifyWithRetry(endPoint, {[expectedBody.key as string]: expectedBody.value}, requestBody, endPoint);
    }

    return 'Success';
  }

  private parseResponse(response: any): Record<string, unknown> {
    if (typeof response === 'string') {
      const trimmed = response.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
      try {
        return JSON.parse(trimmed);
      } catch (err) {
        console.error('[LCU] Failed to parse response');
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
      if (expected === undefined) return true;
      return this.valuesMatch(key, actual, expected);
    });
  }

  private shouldLogRequestFailure(method: string, endPoint: string, message: string): boolean {
    if (method !== 'GET') return true;
    if (/404\b|LOBBY_NOT_FOUND|RESOURCE_NOT_FOUND|not found/i.test(message)) return false;
    if (endPoint.indexOf('/lol-lobby/') === 0 && /RPC_ERROR/i.test(message)) return false;
    return true;
  }

  private valuesMatch(key: string, actual: unknown, expected: unknown): boolean {
    if (key === 'challengePoints') {
      return String(actual) === String(expected);
    }
    if (key === 'rankedLeagueDivision' && expected === '') {
      return actual === undefined || actual === null || actual === '';
    }
    if (typeof actual === 'string' && typeof expected === 'string' && this.shouldNormalizeCase(key)) {
      return actual.toUpperCase() === expected.toUpperCase();
    }
    return actual === expected;
  }

  private shouldNormalizeCase(key: string): boolean {
    return ['rank', 'queue', 'division', 'rankedLeagueTier', 'rankedLeagueQueue', 'rankedLeagueDivision', 'challengeCrystalLevel'].indexOf(key) >= 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private verificationFailed(endPoint: string, requestBody: Record<string, unknown>, actual: Record<string, unknown>, expected: Record<string, unknown>): string {
    const message = `LCU update sent, but ${endPoint} did not reflect the requested value.`;
    console.error('[LCU] Verification failed', this.redact({endpoint: endPoint, payload: requestBody, expected, actual}));
    return `${message} Riot may have overwritten or normalized this field; try again after the client settles.`;
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
      const payload = JSON.stringify(this.redact(body));
      return payload.length > 260 ? `${payload.slice(0, 260)}...` : payload;
    } catch (err) {
      return '[unserializable payload]';
    }
  }

  private redact(value: any, key = ''): any {
    if (this.isSensitiveKey(key)) return '[REDACTED]';
    if (typeof value === 'string') return this.isSensitiveString(value) ? '[REDACTED]' : value;
    if (Array.isArray(value)) return value.map(item => this.redact(item, key));
    if (value && typeof value === 'object') {
      const output = {};
      Object.keys(value).forEach(childKey => {
        output[childKey] = this.redact(value[childKey], childKey);
      });
      return output;
    }
    return value;
  }

  private isSensitiveKey(key: string): boolean {
    const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return [
      'access',
      'auth',
      'authorization',
      'code',
      'cookie',
      'discordid',
      'displayname',
      'gamename',
      'gametag',
      'idtoken',
      'invitation',
      'join',
      'jwt',
      'link',
      'name',
      'password',
      'pid',
      'puuid',
      'refresh',
      'secret',
      'session',
      'statusmessage',
      'summoner',
      'token',
      'url'
    ].some(value => normalized.indexOf(value) >= 0) || normalized.endsWith('id') || normalized.endsWith('ids');
  }

  private isSensitiveString(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/.test(trimmed)) return true;
    if (/^https?:\/\//i.test(trimmed)) return true;
    if (/join.?code|access.?token|refresh.?token|id.?token|authorization|cookie/i.test(trimmed)) return true;
    return /^[A-Za-z0-9_-]{24,}$/.test(trimmed) && /[A-Za-z]/.test(trimmed) && /\d/.test(trimmed);
  }

}
