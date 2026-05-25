import {Component, OnInit} from '@angular/core';
import {DialogComponent} from "../core/dialog/dialog.component";
import {MatDialog} from "@angular/material/dialog";
import {LCUConnectionService} from "../core/services/lcuconnection/lcuconnection.service";
import {VersionService} from "../core/services/version/version.service";
import {ChampionService} from "../core/services/champion/champion.service";

@Component({
  selector: 'app-background',
  templateUrl: './background.component.html',
  styleUrls: ['./background.component.css']
})
export class BackgroundComponent implements OnInit {
  private static cachedVersion = '';
  private static cachedChampionImages = [];
  private static cachedChampionKeys: Record<string, number> = {};
  private static cachedSkins = {};
  private skinRequestId = 0;
  private championKeys: Record<string, number> = {};
  public showingSkins = false;
  public currentVersion: string;
  public championImages = [];
  public skinsImages = [];
  public searchText: string;
  public championsLoading = true;
  public skinsLoading = false;
  public skinsLoaded = 0;
  public skinsTotal = 0;

  constructor(public dialog: MatDialog, private lcuConnectionService: LCUConnectionService, private version: VersionService, private championData: ChampionService) {
  }

  async ngOnInit() {
    if (BackgroundComponent.cachedChampionImages.length) {
      this.currentVersion = BackgroundComponent.cachedVersion;
      this.championImages = BackgroundComponent.cachedChampionImages;
      this.championKeys = BackgroundComponent.cachedChampionKeys;
      this.championsLoading = false;
      return;
    }
    this.version.apiVersion().subscribe(v => {
      this.currentVersion = v[0];
      this.championData.getChampionIcons(this.currentVersion).subscribe(championData => {
        try {
          const championPayload = championData as any;
          const championImages = [];
          const championKeys: Record<string, number> = {};
          for (const champion in championPayload.data) {
            const championInfo = championPayload.data[champion];
            const src = `https://ddragon.leagueoflegends.com/cdn/${this.currentVersion}/img/champion/${champion}.png`;
            championKeys[champion] = parseInt(championInfo.key, 10);
            championImages.push({
              src: src,
              alt: champion,
              loaded: false,
              broken: false
            });
          }
          BackgroundComponent.cachedVersion = this.currentVersion;
          BackgroundComponent.cachedChampionImages = championImages;
          BackgroundComponent.cachedChampionKeys = championKeys;
          this.championImages = championImages;
          this.championKeys = championKeys;
          this.championsLoading = false;
        } catch (err) {
          console.error(err);
          this.championsLoading = false;
        }
      }, error => {
        console.error('[Assets] failed to load champion list', error);
        this.championsLoading = false;
      })
    }, error => {
      console.error('[Assets] failed to load Data Dragon version', error);
      this.championsLoading = false;
    })
  }

  public async getSkins(alt: string) {
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
      this.championData.getSkins(this.currentVersion, alt).subscribe(async champion => {
        if (requestId !== this.skinRequestId) return;
        const skins = champion["data"][alt]["skins"];
        const skinImages = this.buildSkinImages(alt, skins);
        this.skinsTotal = skinImages.length;
        const loadedSkins = await this.preloadImages(skinImages, requestId);
        if (requestId !== this.skinRequestId) return;
        BackgroundComponent.cachedSkins[alt] = loadedSkins;
        this.skinsImages = loadedSkins;
        this.skinsLoading = false;
      }, error => {
        console.error('[Assets] failed to load champion skin data', {champion: alt, error});
        this.skinsLoading = false;
      })
    } catch (error) {
      console.error(error);
      this.skinsLoading = false;
    }
  }

  public showChampions() {
    this.skinRequestId++;
    this.showingSkins = false;
    this.skinsLoading = false;
    this.skinsImages = [];
  }

  public onImageLoad(image: Record<string, unknown>) {
    image.loaded = true;
  }

  public onImageError(event: Event, image: Record<string, unknown>) {
    image.broken = true;
    console.warn('[Assets] failed image load', image);
    const target = event.target as HTMLImageElement;
    target.style.display = 'none';
  }

  private buildSkinImages(alt: string, skins: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const skinImages = [];
    const seenSkinNums = {};

    for (const skin of skins || []) {
      if (!this.isUsableSkin(alt, skin)) continue;

      const skinNum = skin.num as number;
      if (seenSkinNums[skinNum]) continue;
      seenSkinNums[skinNum] = true;

      skinImages.push({
        src: `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${alt}_${skinNum}.jpg`,
        alt: skin.id,
        num: skinNum,
        name: skin.name,
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
      return (left.num as number) - (right.num as number);
    }).map((image, index) => {
      return {...image, order: index};
    });
  }

  private isUsableSkin(alt: string, skin: Record<string, unknown>): boolean {
    if (!skin || typeof skin !== 'object') return false;
    if (typeof skin.num !== 'number' || skin.num < 0) return false;
    if (skin.id === undefined || skin.id === null) return false;
    if (typeof skin.name === 'string' && skin.name.trim() === '') return false;
    if (typeof skin.name === 'string' && skin.name.toLowerCase() === 'default' && skin.num !== 0) return false;

    const championKey = this.championKeys[alt];
    const skinId = parseInt(String(skin.id), 10);
    if (championKey && !isNaN(skinId)) {
      return skinId === championKey * 1000 + skin.num;
    }

    return true;
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

  public setBackground(id: string) {
    const body = {
      key: "backgroundSkinId",
      value: parseInt(id)
    };
    this.lcuConnectionService.requestSend(body, 'POST', 'profile').then(response => {
      this.dialog.open(DialogComponent, {
        data: {body: response}
      });
    });
  }

  public trackByAlt(index: number, image: Record<string, unknown>) {
    return image.alt;
  }

  public trackBySkin(index: number, image: Record<string, unknown>) {
    return image.alt;
  }
}
