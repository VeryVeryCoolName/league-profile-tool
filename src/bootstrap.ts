import 'zone.js';
import { enableProdMode, provideZoneChangeDetection } from '@angular/core';
import { platformBrowser } from '@angular/platform-browser';

import { AppModule } from './app/app.module';
import { AppConfig } from './environments/environment';

export function bootstrapApp(): Promise<unknown> {
  if (AppConfig.production) {
    enableProdMode();
  }

  return platformBrowser().bootstrapModule(AppModule, {
    applicationProviders: [provideZoneChangeDetection({
      eventCoalescing: true,
      runCoalescing: true
    })],
    preserveWhitespaces: false
  });
}
