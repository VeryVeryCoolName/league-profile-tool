import {Injectable, OnDestroy} from '@angular/core';
import {BehaviorSubject, firstValueFrom, Observable, Subscription} from 'rxjs';
import {LCUConnectionService} from '../lcuconnection/lcuconnection.service';
import {VersionService} from '../version/version.service';
import {ChampionService} from '../champion/champion.service';
import {ConnectorService} from '../connector/connector.service';
import {LcuEventsService, LcuJsonApiEvent} from '../lcu-events/lcu-events.service';

export interface IdentityPreviewState {
  loaded: boolean;
  loading: boolean;
  error: string;
  updatedAt: string;
  summonerName: string;
  tagLine: string;
  profileIconId: number | null;
  profileIconName: string;
  profileIconUrl: string;
  chatRankTier: string;
  chatRankDivision: string;
  chatRankQueue: string;
  challengeCrystalLevel: string;
  challengePoints: number | null;
  challengeSpoofActive: boolean;
  backgroundSkinId: number | null;
  backgroundImageUrl: string;
  backgroundVideoUrl: string;
  backgroundLabel: string;
  availabilityLabel: string;
  statusMessage: string;
}

@Injectable({
  providedIn: 'root'
})
export class IdentityPreviewService implements OnDestroy {
  private readonly defaultState: IdentityPreviewState = {
    loaded: false,
    loading: false,
    error: '',
    updatedAt: '',
    summonerName: 'Summoner',
    tagLine: '',
    profileIconId: null,
    profileIconName: '',
    profileIconUrl: '',
    chatRankTier: '',
    chatRankDivision: '',
    chatRankQueue: '',
    challengeCrystalLevel: '',
    challengePoints: null,
    challengeSpoofActive: false,
    backgroundSkinId: null,
    backgroundImageUrl: '',
    backgroundVideoUrl: '',
    backgroundLabel: '',
    availabilityLabel: '',
    statusMessage: ''
  };

  private readonly stateSubject = new BehaviorSubject<IdentityPreviewState>({...this.defaultState});
  private dataDragonVersion = '';
  private championIdByKey: Record<number, string> = {};
  private championNameByKey: Record<number, string> = {};
  private profileIconNameById: Record<number, string> = {};
  private refreshPromise: Promise<void> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastIdentityKey = '';
  private readonly connectorSubscription: Subscription;
  private readonly eventsSubscription: Subscription;
  public readonly state$: Observable<IdentityPreviewState> = this.stateSubject.asObservable();

  constructor(
    private lcuConnectionService: LCUConnectionService,
    private versionService: VersionService,
    private championService: ChampionService,
    private connector: ConnectorService,
    private lcuEvents: LcuEventsService
  ) {
    this.connectorSubscription = this.connector.ready$.subscribe(ready => {
      if (ready) {
        this.scheduleRefresh();
      } else {
        this.resetPreview();
      }
    });
    this.eventsSubscription = this.lcuEvents.events$.subscribe(event => this.handleLcuEvent(event));
  }

  ngOnDestroy(): void {
    this.connectorSubscription.unsubscribe();
    this.eventsSubscription.unsubscribe();
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
  }

  public async refreshPreview(): Promise<void> {
    if (this.refreshPromise !== null) return this.refreshPromise;
    this.refreshPromise = this.refreshPreviewInternal().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async refreshPreviewInternal(): Promise<void> {
    const current = this.stateSubject.value;
    this.patchState({loading: true, error: ''});

    try {
      const [summoner, profile, chat] = await Promise.all([
        this.readObject('/lol-summoner/v1/current-summoner'),
        this.readObject('/lol-summoner/v1/current-summoner/summoner-profile'),
        this.readObject('/lol-chat/v1/me')
      ]);

      const identityKey = this.identityKey(summoner);
      const accountChanged = !!identityKey && !!this.lastIdentityKey && identityKey !== this.lastIdentityKey;
      const fallbackState = accountChanged ? this.defaultState : current;
      if (identityKey) this.lastIdentityKey = identityKey;

      const challengeSummary = fallbackState.challengeSpoofActive
        ? null
        : await this.readObject('/lol-challenges/v1/summary-player-data/local-player');
      const lol = chat && chat.lol ? chat.lol as Record<string, unknown> : {};
      const availability = this.stringFrom(chat && chat.availability, '');
      const summaryLevel = this.stringFrom(challengeSummary && challengeSummary.overallChallengeLevel, '');
      const summaryPoints = this.numberFrom(challengeSummary && challengeSummary.totalChallengeScore, null);
      const accountProfileIconId = this.numberFrom(summoner.profileIconId, fallbackState.profileIconId);
      const chatIconId = this.numberFrom(chat && chat.icon, null);
      const hovercardIconId = chatIconId === null
        ? await this.readHovercardProfileIcon(summoner)
        : null;
      const profileIconId = this.firstKnownNumber(chatIconId, hovercardIconId, accountProfileIconId);
      const backgroundSkinId = this.numberFrom(profile.backgroundSkinId, fallbackState.backgroundSkinId);
      const sameProfileIcon = fallbackState.profileIconId === profileIconId;
      const sameBackground = fallbackState.backgroundSkinId === backgroundSkinId;
      const chatRankTier = fallbackState.challengeSpoofActive
        ? fallbackState.chatRankTier
        : this.stringFrom(lol.rankedLeagueTier, fallbackState.chatRankTier);
      const chatRankDivision = chatRankTier.toUpperCase() === 'UNRANKED'
        ? ''
        : fallbackState.challengeSpoofActive
          ? fallbackState.chatRankDivision
          : this.stringFrom(lol.rankedLeagueDivision, fallbackState.chatRankDivision);

      const nextState: Partial<IdentityPreviewState> = {
        loaded: true,
        loading: false,
        error: '',
        updatedAt: new Date().toLocaleTimeString(),
        summonerName: this.stringFrom(summoner.gameName, this.stringFrom(summoner.displayName, fallbackState.summonerName || 'Summoner')),
        tagLine: this.stringFrom(summoner.tagLine, fallbackState.tagLine),
        profileIconId,
        profileIconName: sameProfileIcon ? fallbackState.profileIconName : 'Icon',
        profileIconUrl: this.profileIconUrl(profileIconId),
        availabilityLabel: this.availabilityLabel(availability, fallbackState.availabilityLabel),
        statusMessage: this.stringFrom(chat && chat.statusMessage, fallbackState.statusMessage),
        chatRankTier,
        chatRankDivision,
        chatRankQueue: fallbackState.challengeSpoofActive ? fallbackState.chatRankQueue : this.stringFrom(lol.rankedLeagueQueue, fallbackState.chatRankQueue),
        challengeCrystalLevel: fallbackState.challengeSpoofActive ? fallbackState.challengeCrystalLevel : this.stringFrom(summaryLevel, this.stringFrom(lol.challengeCrystalLevel, fallbackState.challengeCrystalLevel)),
        challengePoints: fallbackState.challengeSpoofActive ? fallbackState.challengePoints : this.numberFrom(summaryPoints, this.numberFrom(lol.challengePoints, fallbackState.challengePoints)),
        challengeSpoofActive: fallbackState.challengeSpoofActive,
        backgroundSkinId,
        backgroundImageUrl: sameBackground ? fallbackState.backgroundImageUrl : '',
        backgroundVideoUrl: sameBackground ? fallbackState.backgroundVideoUrl : '',
        backgroundLabel: sameBackground ? fallbackState.backgroundLabel : (backgroundSkinId ? `Skin ${backgroundSkinId}` : '')
      };

      this.patchState(nextState);
      void this.resolvePreviewDetails(profileIconId, backgroundSkinId);
    } catch (error) {
      this.patchState({
        loading: false,
        error: 'Could not refresh preview. Make sure League Client is open and connected.'
      });
    }
  }

  public applyChatRank(queue: string, tier: string, division: string): void {
    this.patchState({
      loaded: true,
      chatRankQueue: queue,
      chatRankTier: tier,
      chatRankDivision: division,
      updatedAt: new Date().toLocaleTimeString()
    });
  }

  public applyChallengeSpoof(level: string, points: number): void {
    this.patchState({
      loaded: true,
      challengeCrystalLevel: level,
      challengePoints: points,
      challengeSpoofActive: true,
      updatedAt: new Date().toLocaleTimeString()
    });
  }

  public applyRealChallengeRank(level: string, points: number | null): void {
    this.patchState({
      loaded: true,
      challengeCrystalLevel: level,
      challengePoints: points,
      challengeSpoofActive: false,
      updatedAt: new Date().toLocaleTimeString()
    });
  }

  public clearChallengeSpoof(): void {
    this.patchState({
      challengeSpoofActive: false,
      updatedAt: new Date().toLocaleTimeString()
    });
  }

  public applyAvailability(availability: string): void {
    this.patchState({
      loaded: true,
      availabilityLabel: this.availabilityLabel(availability, this.stateSubject.value.availabilityLabel),
      updatedAt: new Date().toLocaleTimeString()
    });
  }

  public applyStatusMessage(statusMessage: string): void {
    this.patchState({
      loaded: true,
      statusMessage,
      updatedAt: new Date().toLocaleTimeString()
    });
  }

  public applyProfileIcon(profileIconId: number): void {
    this.patchState({
      loaded: true,
      profileIconId,
      profileIconName: 'Icon',
      profileIconUrl: this.profileIconUrl(profileIconId),
      updatedAt: new Date().toLocaleTimeString()
    });
    this.resolveProfileIconName(profileIconId).then(profileIconName => {
      if (this.stateSubject.value.profileIconId !== profileIconId) return;
      this.patchState({profileIconName});
    });
  }

  public applyBackgroundSkinId(backgroundSkinId: number): void {
    this.patchState({
      loaded: true,
      backgroundSkinId,
      backgroundImageUrl: '',
      backgroundVideoUrl: '',
      backgroundLabel: backgroundSkinId ? `Skin ${backgroundSkinId}` : '',
      updatedAt: new Date().toLocaleTimeString()
    });
    this.resolveBackground(backgroundSkinId).then(background => {
      if (this.stateSubject.value.backgroundSkinId !== backgroundSkinId) return;
      this.patchState({
        backgroundImageUrl: background.url,
        backgroundVideoUrl: background.videoUrl,
        backgroundLabel: background.label
      });
    });
  }

  public resetPreview(): void {
    this.lastIdentityKey = '';
    this.patchState({...this.defaultState});
  }

  private async resolvePreviewDetails(profileIconId: number | null, backgroundSkinId: number | null): Promise<void> {
    try {
      const [profileIconName, background] = await Promise.all([
        this.resolveProfileIconName(profileIconId),
        this.resolveBackground(backgroundSkinId)
      ]);

      const current = this.stateSubject.value;
      if (current.profileIconId !== profileIconId || current.backgroundSkinId !== backgroundSkinId) return;

      this.patchState({
        profileIconName,
        backgroundImageUrl: background.url,
        backgroundVideoUrl: background.videoUrl,
        backgroundLabel: background.label
      });
    } catch (error) {
      console.warn('[Preview] metadata unavailable', error);
    }
  }

  private patchState(patch: Partial<IdentityPreviewState>) {
    const current = this.stateSubject.value;
    const next = {
      ...current,
      ...patch
    };
    const changed = (Object.keys(patch) as Array<keyof IdentityPreviewState>).some(key => current[key] !== next[key]);
    if (!changed) return;
    this.stateSubject.next(next);
  }

  private handleLcuEvent(event: LcuJsonApiEvent): void {
    const uri = String(event && event.uri || '').toLowerCase();
    if (
      uri.indexOf('/lol-summoner/v1/current-summoner') === 0 ||
      uri.indexOf('/lol-chat/v1/me') === 0 ||
      uri.indexOf('/lol-login/v1/session') === 0
    ) {
      this.scheduleRefresh();
    }
  }

  private scheduleRefresh(): void {
    if (!this.connector.isReady()) return;
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshPreview();
    }, 350);
  }

  private async readObject(path: string): Promise<Record<string, unknown>> {
    const response = await this.lcuConnectionService.requestCustomAPI({}, 'GET', path);
    const parsed = this.parseResponse(response);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  }

  private async readHovercardProfileIcon(summoner: Record<string, unknown>): Promise<number | null> {
    const puuid = this.stringFrom(summoner && summoner.puuid, '');
    if (!puuid) return null;

    try {
      const hovercard = await this.readObject(`/lol-hovercard/v1/friend-info/${puuid}`);
      return this.firstKnownNumber(
        this.numberFrom(hovercard.summonerIcon, null),
        this.numberFrom(hovercard.icon, null)
      );
    } catch (error) {
      return null;
    }
  }

  private parseResponse(response: any): any {
    if (typeof response !== 'string') return response;
    try {
      return JSON.parse(response);
    } catch (error) {
      return null;
    }
  }

  private identityKey(summoner: Record<string, unknown>): string {
    const puuid = this.stringFrom(summoner && summoner.puuid, '');
    if (puuid) return `puuid:${puuid}`;

    const summonerId = this.stringFrom(summoner && summoner.summonerId, '');
    if (summonerId) return `summoner:${summonerId}`;

    const accountId = this.stringFrom(summoner && summoner.accountId, '');
    if (accountId) return `account:${accountId}`;

    const name = this.stringFrom(summoner && summoner.gameName, this.stringFrom(summoner && summoner.displayName, ''));
    const tagLine = this.stringFrom(summoner && summoner.tagLine, '');
    return name ? `name:${name}#${tagLine}` : '';
  }

  private async resolveBackground(backgroundSkinId: number | null): Promise<{url: string; videoUrl: string; label: string}> {
    if (!backgroundSkinId && backgroundSkinId !== 0) return {url: '', videoUrl: '', label: ''};
    if (backgroundSkinId === 0) return {url: '', videoUrl: '', label: 'Default'};

    try {
      await this.ensureChampionMap();
      const championKey = Math.floor(backgroundSkinId / 1000);
      const skinNumber = backgroundSkinId % 1000;
      const championId = this.championIdByKey[championKey];
      if (!championId) return {url: '', videoUrl: '', label: `Skin ${backgroundSkinId}`};
      const championName = this.championNameByKey[championKey] || championId;
      const catalogSkin = await this.resolveCatalogSkin(backgroundSkinId);
      const skinName = this.catalogSkinName(catalogSkin, championName);
      const catalogUrl = this.communityDragonAssetUrl(catalogSkin && (catalogSkin.splashPath || catalogSkin.loadScreenPath));
      const catalogVideoUrl = this.communityDragonAssetUrl(catalogSkin && catalogSkin.splashVideoPath);

      return {
        url: catalogUrl || `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championId}_${skinNumber}.jpg`,
        videoUrl: catalogVideoUrl,
        label: skinName || `${championName} skin ${skinNumber}`
      };
    } catch (error) {
      console.warn('[Preview] background metadata unavailable', error);
      return {url: '', videoUrl: '', label: `Skin ${backgroundSkinId}`};
    }
  }

  private async resolveCatalogSkin(backgroundSkinId: number): Promise<Record<string, any> | null> {
    try {
      const skinCatalog = await firstValueFrom(this.championService.getSkinCatalog());
      const skin = skinCatalog && skinCatalog[String(backgroundSkinId)];
      if (skin) return skin;

      for (const catalogSkin of Object.values(skinCatalog || {})) {
        const tiers = catalogSkin && catalogSkin.questSkinInfo && Array.isArray(catalogSkin.questSkinInfo.tiers)
          ? catalogSkin.questSkinInfo.tiers
          : [];
        const tier = tiers.find(item => Number(item && item.id) === backgroundSkinId);
        if (tier) return tier;
      }

      return null;
    } catch (error) {
      console.warn('[Preview] background skin metadata unavailable', error);
      return null;
    }
  }

  private catalogSkinName(skin: Record<string, any> | null, championName: string): string {
    if (!skin) return '';
    const rawName = this.stringFrom(skin.name, '');
    if (skin.isBase || !rawName || rawName === championName) return `${championName} Default`;
    return rawName;
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

  private async ensureChampionMap(): Promise<void> {
    if (Object.keys(this.championIdByKey).length > 0) return;
    await this.ensureVersion();
    if (!this.dataDragonVersion) return;

    const championPayload: any = await firstValueFrom(this.championService.getChampionIcons(this.dataDragonVersion));
    const nextMap: Record<number, string> = {};
    const nextNameMap: Record<number, string> = {};
    Object.keys(championPayload.data || {}).forEach(championId => {
      const champion = championPayload.data[championId];
      const key = Number(champion && champion.key);
      if (!isNaN(key)) {
        nextMap[key] = championId;
        nextNameMap[key] = this.stringFrom(champion && champion.name, championId);
      }
    });
    this.championIdByKey = nextMap;
    this.championNameByKey = nextNameMap;
  }

  private async resolveProfileIconName(profileIconId: number | null): Promise<string> {
    if (profileIconId === undefined || profileIconId === null || isNaN(profileIconId)) return '';
    try {
      await this.ensureProfileIconMap();
      return this.profileIconNameById[profileIconId] || 'Icon';
    } catch (error) {
      console.warn('[Preview] profile icon metadata unavailable', error);
      return 'Icon';
    }
  }

  private async ensureProfileIconMap(): Promise<void> {
    if (Object.keys(this.profileIconNameById).length > 0) return;

    const icons: any = await firstValueFrom(this.championService.getSummonerIcons());
    const nextMap: Record<number, string> = {};
    (icons || []).forEach(icon => {
      const id = Number(icon && icon.id);
      const name = this.stringFrom(icon && icon.title, this.stringFrom(icon && icon.name, 'Icon'));
      if (!isNaN(id)) nextMap[id] = name || 'Icon';
    });
    this.profileIconNameById = nextMap;
  }

  private async ensureVersion(): Promise<void> {
    if (this.dataDragonVersion) return;
    const versions = await firstValueFrom(this.versionService.apiVersion());
    this.dataDragonVersion = versions && versions.length ? versions[0] : '';
  }

  private profileIconUrl(profileIconId: number | null): string {
    if (profileIconId === undefined || profileIconId === null || isNaN(profileIconId)) return '';
    return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${profileIconId}.jpg`;
  }

  private availabilityLabel(availability: string, fallback = ''): string {
    const normalized = String(availability || '').trim().toLowerCase();
    if (normalized === 'chat' || normalized === 'online') return 'Online';
    if (normalized === 'away') return 'Away';
    if (normalized === 'mobile') return 'Mobile';
    if (normalized === 'offline') return 'Invisible / Offline';
    if (normalized === 'dnd') return 'In Game';
    return fallback || 'Not loaded';
  }

  private stringFrom(value: unknown, fallback = ''): string {
    if (value === undefined || value === null || value === '') return fallback;
    return String(value);
  }

  private numberFrom(value: unknown, fallback: number | null = null): number | null {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return isNaN(parsed) ? fallback : parsed;
  }

  private firstKnownNumber(...values: Array<number | null>): number | null {
    for (const value of values) {
      if (value !== undefined && value !== null && !isNaN(value)) return value;
    }
    return null;
  }
}
