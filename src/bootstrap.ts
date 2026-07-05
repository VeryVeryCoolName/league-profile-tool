import 'zone.js';
import { enableProdMode, provideZoneChangeDetection } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { AppConfig } from './environments/environment';

export function bootstrapApp(): Promise<unknown> {
  if (AppConfig.production) {
    enableProdMode();
  }

  return platformBrowserDynamic().bootstrapModule(AppModule, {
    applicationProviders: [provideZoneChangeDetection({
      eventCoalescing: true,
      runCoalescing: true
    })],
    preserveWhitespaces: false
  });
}
