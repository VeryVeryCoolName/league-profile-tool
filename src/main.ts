import { enableProdMode, provideZoneChangeDetection } from '@angular/core';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';

import { AppModule } from './app/app.module';
import { AppConfig } from './environments/environment';

if (AppConfig.production) {
  enableProdMode();
}

function paintBeforeBootstrap(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 150);
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

paintBeforeBootstrap()
  .then(() => platformBrowserDynamic().bootstrapModule(AppModule, {
    applicationProviders: [provideZoneChangeDetection({
      eventCoalescing: true,
      runCoalescing: true
    })],
    preserveWhitespaces: false
  }))
  .catch(err => console.error(err));
