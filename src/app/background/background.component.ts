import {Component, OnInit, OnDestroy, ChangeDetectionStrategy} from '@angular/core';
import {DialogComponent} from "../core/dialog/dialog.component";
import {MatDialog} from "@angular/material/dialog";
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";
import {VersionService} from "../core/services/version/version.service";
import {ChampionService} from "../core/services/champion/champion.service";
import {IdentityPreviewService} from "../core/services/identity-preview/identity-preview.service";
import {Subscription} from 'rxjs';

@Component({
    selector: 'app-background',
    templateUrl: './background.component.html',
    styleUrls: ['./background.component.css'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class BackgroundComponent implements OnInit, OnDestroy {
  private static cachedVersion = '';
  private static cachedChampionImages = [];
  private static cachedChampionKeys: Record<string, number> = {};
  private static cachedSkins = {};
  private skinRequestId = 0;
  private championKeys: Record<string, number> = {};
  public showingSkins = false;
  public currentVersion: string;
  public championImages = [];
  public filteredChampionImages = [];
  public visibleChampionImages = [];
  public skinsImages = [];
  public searchText: string;
  public championsLoading = true;
  public skinsLoading = false;
  public skinsLoaded = 0;
  public skinsTotal = 0;
  public selectedBackgroundSkinId: number | null = null;
  private previewSubscription: Subscription;

  constructor(public dialog: MatDialog, private lcuConnectionService: LCUConnectionService, private version: VersionService, private championData: ChampionService, private identityPreviewService: IdentityPreviewService) {
    this.previewSubscription = this.identityPreviewService.state$.subscribe(state => {
      this.selectedBackgroundSkinId = state.backgroundSkinId;
    });
  }

  ngOnInit(): void {
    if (BackgroundComponent.cachedChampionImages.length) {
      this.currentVersion = BackgroundComponent.cachedVersion;
      this.championImages = BackgroundComponent.cachedChampionImages;
      this.championKeys = BackgroundComponent.cachedChampionKeys;
      this.championsLoading = false;
      this.refreshChampionView();
      return;
    }
    this.version.apiVersion().subscribe(v => {
      this.currentVersion = v[0];
      this.championData.getChampionIcons(this.currentVersion).subscribe(championData => {
        try {
          const championPayload = championData;
          const championImages = [];
          const championKeys: Record<string, number> = {};
          for (const champion in championPayload.data) {
            const championInfo = championPayload.data[champion];
            const src = `https://ddragon.leagueoflegends.com/cdn/${this.currentVersion}/img/champion/${champion}.png`;
            championKeys[champion] = parseInt(championInfo.key, 10);
            championImages.push({
              src: src,
              alt: champion,
              name: this.displayChampionName(championInfo, champion),
              loaded: false,
              broken: false
            });
          }
          championImages.sort((left, right) => {
            return String(left.name || left.alt || '').localeCompare(String(right.name || right.alt || ''));
          });
          BackgroundComponent.cachedVersion = this.currentVersion;
          BackgroundComponent.cachedChampionImages = championImages;
          BackgroundComponent.cachedChampionKeys = championKeys;
          this.championImages = championImages;
          this.championKeys = championKeys;
          this.championsLoading = false;
          this.refreshChampionView();
        } catch (err) {
          console.error(err);
          this.championsLoading = false;
        }
      }, error => {
        console.error('[Assets] failed to load champion list', error);
        this.championsLoading = false;
      });
    }, error => {
      console.error('[Assets] failed to load Data Dragon version', error);
      this.championsLoading = false;
    });
  }

  public getSkins(alt: string): void {
    this.skinsImages = [];
    this.showingSkins = true;
    this.skinsLoading = true;
    this.skinsLoaded = 0;
    this.skinsTotal = 0;
    const requestId = ++this.skinRequestId;
    if (BackgroundComponent.cachedSkins[alt]) {
      this.skinsImages = BackgroundComponent.cachedSkins[alt].map(skin => ({...skin, loaded: true}));
      this.skinsLoaded = this.skinsImages.length;
      this.skinsTotal = this.skinsImages.length;
      this.skinsLoading = false;
      return;
    }
    try {
      this.championData.getSkinCatalog().subscribe(skinCatalog => {
        if (requestId !== this.skinRequestId) return;
        const skinImages = this.buildCatalogSkinImages(alt, skinCatalog);
        this.skinsTotal = skinImages.length;
        this.preloadImages(skinImages, requestId).then(loadedSkins => {
          if (requestId !== this.skinRequestId) return;
          BackgroundComponent.cachedSkins[alt] = loadedSkins;
          this.skinsImages = loadedSkins;
          this.skinsLoading = false;
        });
      }, error => {
        console.warn('[Assets] failed to load clean skin catalog, falling back to Data Dragon', {champion: alt, error});
        this.loadDataDragonSkins(alt, requestId);
      });
    } catch (error) {
      console.warn('[Assets] failed to start clean skin catalog request, falling back to Data Dragon', {champion: alt, error});
      this.loadDataDragonSkins(alt, requestId);
    }
  }

  ngOnDestroy(): void {
    this.previewSubscription.unsubscribe();
  }

  private loadDataDragonSkins(alt: string, requestId: number): void {
    try {
      this.championData.getSkins(this.currentVersion, alt).subscribe(champion => {
        if (requestId !== this.skinRequestId) return;
        const skins = champion["data"][alt]["skins"];
        const skinImages = this.buildSkinImages(alt, skins);
        this.skinsTotal = skinImages.length;
        this.preloadImages(skinImages, requestId).then(loadedSkins => {
          if (requestId !== this.skinRequestId) return;
          BackgroundComponent.cachedSkins[alt] = loadedSkins;
          this.skinsImages = loadedSkins;
          this.skinsLoading = false;
        });
      }, error => {
        console.error('[Assets] failed to load champion skin data', {champion: alt, error});
        this.skinsLoading = false;
      });
    } catch (error) {
      console.error(error);
      this.skinsLoading = false;
    }
  }

  public showChampions(): void {
    this.skinRequestId++;
    this.showingSkins = false;
    this.skinsLoading = false;
    this.skinsImages = [];
  }

  public refreshChampionView(): void {
    const search = String(this.searchText || '').trim().toLowerCase();
    this.filteredChampionImages = search
      ? this.championImages.filter(champion => {
        return String(champion.name || '').toLowerCase().indexOf(search) >= 0 ||
          String(champion.alt || '').toLowerCase().indexOf(search) >= 0;
      })
      : this.championImages;
    this.visibleChampionImages = this.filteredChampionImages;
  }

  public resetChampionLimit(): void {
    this.refreshChampionView();
  }

  public onImageLoad(image: Record<string, unknown>): void {
    image.loaded = true;
  }

  public onImageError(event: Event, image: Record<string, unknown>): void {
    image.broken = true;
    console.warn('[Assets] failed image load', image);
    const target = event.target as HTMLImageElement;
    target.style.display = 'none';
  }

  public isSelectedChampion(alt: unknown): boolean {
    if (this.selectedBackgroundSkinId === null) return false;
    const championKey = this.championKeys[String(alt || '')];
    return !!championKey && Math.floor(this.selectedBackgroundSkinId / 1000) === championKey;
  }

  public isSelectedSkin(skinId: unknown): boolean {
    if (this.selectedBackgroundSkinId === null) return false;
    return Number(skinId) === this.selectedBackgroundSkinId;
  }

  private buildSkinImages(alt: string, skins: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const skinImages = [];
    const seenSkinNums = {};
    const championName = this.championDisplayName(alt);

    for (const skin of skins || []) {
      if (!this.isUsableSkin(alt, skin)) continue;

      const skinNum = skin.num as number;
      if (seenSkinNums[skinNum]) continue;
      seenSkinNums[skinNum] = true;

      skinImages.push({
        src: `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${alt}_${skinNum}.jpg`,
        alt: skin.id,
        num: skinNum,
        name: this.displaySkinName(skin.name, championName),
        order: 0,
        loaded: false,
        broken: false
      });
    }

    if (skinImages.length > 40) {
      console.warn('[Assets] unusually high skin candidate count after filtering', {champion: alt, count: skinImages.length});
    }

    return skinImages.sort((left, right) => {
      if (left.num === 0) return -1;
      if (right.num === 0) return 1;
      return left.num - right.num;
    }).map((image, index) => {
      return {...image, order: index};
    });
  }

  private buildCatalogSkinImages(alt: string, skinsById: Record<string, any>): Array<Record<string, unknown>> {
    const skinImages = [];
    const championKey = this.championKeys[alt];
    const championName = this.championDisplayName(alt);

    for (const skin of Object.values(skinsById || {})) {
      this.catalogSkinEntries(skin, championKey, championName, alt).forEach(entry => skinImages.push(entry));
    }

    return skinImages.sort((left, right) => {
      if (left.num === 0) return -1;
      if (right.num === 0) return 1;
      return (left.num as number) - (right.num as number);
    }).map((image, index) => {
      return {...image, order: index};
    });
  }

  private catalogSkinEntries(skin: any, championKey: number, championName: string, alt: string): Array<Record<string, unknown>> {
    if (!this.isCatalogChampionSkin(skin, championKey)) return [];

    const baseEntry = this.catalogSkinEntry(skin, championKey, championName, alt);
    const tierEntries = this.catalogSkinTierEntries(skin, championKey, championName, alt);
    const entries = [baseEntry, ...tierEntries].filter(Boolean);
    const seen = {};
    return entries.filter(entry => {
      const id = String(entry.alt || '');
      if (!id || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  private catalogSkinTierEntries(skin: any, championKey: number, championName: string, alt: string): Array<Record<string, unknown>> {
    const tiers = skin && skin.questSkinInfo && Array.isArray(skin.questSkinInfo.tiers)
      ? skin.questSkinInfo.tiers
      : [];
    return tiers
      .map(tier => this.catalogSkinEntry(tier, championKey, championName, alt))
      .filter(Boolean);
  }

  private catalogSkinEntry(skin: any, championKey: number, championName: string, alt: string): Record<string, unknown> | null {
    const skinId = Number(skin && skin.id);
    if (!Number.isFinite(skinId)) return null;
    if (Math.floor(skinId / 1000) !== championKey) return null;

    const skinNum = skinId - championKey * 1000;
    if (!Number.isInteger(skinNum) || skinNum < 0) return null;

    const rawName = String(skin.name || '').trim();
    const name = skin.isBase || rawName === championName
      ? `${championName} Default`
      : this.displaySkinName(rawName, championName);
    const src = this.communityDragonAssetUrl(skin.loadScreenPath || skin.splashPath) ||
      `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${alt}_${skinNum}.jpg`;

    return {
      src,
      alt: String(skinId),
      num: skinNum,
      name,
      order: 0,
      loaded: false,
      broken: false
    };
  }

  private isCatalogChampionSkin(skin: any, championKey: number): boolean {
    const skinId = Number(skin && skin.id);
    if (!Number.isFinite(skinId) || Math.floor(skinId / 1000) !== championKey) return false;
    return !skin.skinClassification || skin.skinClassification === 'kChampion';
  }

  private isUsableSkin(alt: string, skin: Record<string, unknown>): boolean {
    if (!skin || typeof skin !== 'object') return false;
    if (typeof skin.num !== 'number' || skin.num < 0) return false;
    if (skin.id === undefined || skin.id === null) return false;
    if (typeof skin.name === 'string' && skin.name.trim() === '') return false;
    if (typeof skin.name === 'string' && skin.name.toLowerCase() === 'default' && skin.num !== 0) return false;
    if (this.isChromaVariantName(skin.name)) return false;

    const championKey = this.championKeys[alt];
    const skinId = parseInt(String(skin.id), 10);
    if (championKey && !isNaN(skinId)) {
      return skinId === championKey * 1000 + skin.num;
    }

    return true;
  }

  private isChromaVariantName(name: unknown): boolean {
    const normalized = String(name || '').trim().toLowerCase();
    if (!normalized) return false;
    return /\([^)]+\)\s*$/.test(normalized) ||
      /\bmythic chroma\b/.test(normalized) ||
      /\bchroma\b/.test(normalized) ||
      /\bforge (black iron|bronze|copper)\b/.test(normalized);
  }

  private preloadImages(images: Array<Record<string, unknown>>, requestId: number): Promise<Array<Record<string, unknown>>> {
    return new Promise(resolve => {
      const loadedImages = [];
      let nextIndex = 0;
      let activeLoads = 0;
      let completedLoads = 0;

      const startNext = () => {
        while (activeLoads < 6 && nextIndex < images.length) {
          const image = images[nextIndex++];
          activeLoads++;
          this.preloadImage(image).then(loadedImage => {
            activeLoads--;
            completedLoads++;

            if (loadedImage && requestId === this.skinRequestId) {
              loadedImages.push(loadedImage);
              this.skinsLoaded = loadedImages.length;
              this.skinsImages = loadedImages.slice().sort((left, right) => {
                return (left.order as number) - (right.order as number);
              });
            }

            if (completedLoads === images.length) {
              resolve(loadedImages.slice().sort((left, right) => {
                return (left.order as number) - (right.order as number);
              }));
              return;
            }

            startNext();
          });
        }
      };

      if (!images.length) {
        resolve([]);
        return;
      }

      startNext();
    });
  }

  private preloadImage(image: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return new Promise(resolve => {
      const preloader = new Image();
      let settled = false;
      const done = (loaded: boolean) => {
        if (settled) return;
        settled = true;
        resolve(loaded ? {...image, loaded: true, broken: false} : null);
      };
      const timeout = window.setTimeout(() => done(false), 5000);
      preloader.onload = () => {
        window.clearTimeout(timeout);
        done(true);
      };
      preloader.onerror = () => {
        window.clearTimeout(timeout);
        done(false);
      };
      preloader.src = image.src as string;
    });
  }

  private displayChampionName(champion: any, fallback: string): string {
    return String(champion && champion.name || fallback || '').trim();
  }

  private championDisplayName(alt: string): string {
    const champion = this.championImages.find(item => String(item.alt || '') === alt);
    return String(champion && champion.name || alt || '').trim();
  }

  private displaySkinName(skinName: unknown, championName: string): string {
    const name = String(skinName || '').trim();
    if (!name || name.toLowerCase() === 'default') return `${championName} Default`;
    return name;
  }

  private communityDragonAssetUrl(path: unknown): string {
    const assetPath = String(path || '').trim();
    if (!assetPath) return '';
    const normalizedPath = assetPath
      .replace(/^\/lol-game-data\/assets\//i, '')
      .replace(/^\//, '')
      .toLowerCase();
    return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/${normalizedPath}`;
  }

  public setBackground(id: string): void {
    const body = {
      key: "backgroundSkinId",
      value: parseInt(id)
    };
    this.lcuConnectionService.requestSend(body, 'POST', 'profile').then(response => {
      if (response === 'Success') {
        this.selectedBackgroundSkinId = body.value;
        this.identityPreviewService.applyBackgroundSkinId(body.value);
        void this.identityPreviewService.refreshPreview();
      }
      this.dialog.open(DialogComponent, {
        data: {body: response}
      });
    });
  }

  public trackByAlt(_index: number, image: Record<string, unknown>): unknown {
    return image.alt;
  }

  public trackBySkin(_index: number, image: Record<string, unknown>): unknown {
    return image.alt;
  }
}
