import { Injectable } from '@angular/core';

// If you import a module but never use any of the imported values other than as TypeScript types,
// the resulting javascript file will look as if you never imported the module at all.
import { ipcRenderer, webFrame, shell } from 'electron';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface RequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  rejectUnauthorized?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ElectronService {
  ipcRenderer: typeof ipcRenderer;
  webFrame: typeof webFrame;
  childProcess: typeof childProcess;
  fs: typeof fs;
  path: typeof path;
  shell: typeof shell;
  request: (options: RequestOptions) => Promise<string>;
  private http: any;
  private https: any;
  get isElectron(): boolean {
    return !!(window && window.process && window.process.type);
  }

  constructor() {
    if (this.isElectron) {
      this.ipcRenderer = window.require('electron').ipcRenderer;
      this.webFrame = window.require('electron').webFrame;
      this.shell = window.require('electron').shell;
      this.childProcess = window.require('child_process');
      this.fs = window.require('fs');
      this.path = window.require('path');
      this.http = window.require('http');
      this.https = window.require('https');
      this.request = (options: RequestOptions) => this.makeRequest(options);
    }
  }

  private makeRequest(options: RequestOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const target = new URL(options.url);
      const transport = target.protocol === 'http:' ? this.http : this.https;
      const headers = {...(options.headers || {})};

      const requestOptions = {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: options.method || 'GET',
        headers,
        rejectUnauthorized: options.rejectUnauthorized !== false
      };

      const request = transport.request(requestOptions, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(body);
            return;
          }

          const error: any = new Error(`${response.statusCode} ${response.statusMessage}: ${body}`);
          error.response = {
            body,
            statusCode: response.statusCode
          };
          reject(error);
        });
      });

      request.on('error', reject);
      if (options.body) request.write(options.body);
      request.end();
    });
  }
}
