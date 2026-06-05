import {Injectable} from '@angular/core';
import {BehaviorSubject, Observable} from 'rxjs';
import {LCUConnectionService} from '../lcuconnection/lcuconnection.service';
import {VersionService} from '../version/version.service';
import {ChampionService} from '../champion/champion.service';

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
  backgroundLabel: string;
}

@Injectable({
  providedIn: 'root'
})
export class IdentityPreviewService {
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
    backgroundLabel: ''
  };

  private readonly stateSubject = new BehaviorSubject<IdentityPreviewState>({...this.defaultState});
  private dataDragonVersion = '';
  private championIdByKey: Record<number, string> = {};
  private profileIconNameById: Record<number, string> = {};
  public readonly state$: Observable<IdentityPreviewState> = this.stateSubject.asObservable();

  constructor(
    private lcuConnectionService: LCUConnectionService,
    private versionService: VersionService,
    private championService: ChampionService
  ) {
  }

  public async refreshPreview(): Promise<void> {
    const current = this.stateSubject.value;
    this.patchState({loading: true, error: ''});

    try {
      const [summoner, profile, chat, challengeSummary] = await Promise.all([
        this.readObject('/lol-summoner/v1/current-summoner'),
        this.readObject('/lol-summoner/v1/current-summoner/summoner-profile'),
        this.readObject('/lol-chat/v1/me'),
        current.challengeSpoofActive ? Promise.resolve(null) : this.readObject('/lol-challenges/v1/summary-player-data/local-player')
      ]);

      const lol = chat && chat.lol ? chat.lol as Record<string, unknown> : {};
      const summaryLevel = this.stringFrom(challengeSummary && challengeSummary.overallChallengeLevel, '');
      const summaryPoints = this.numberFrom(challengeSummary && challengeSummary.totalChallengeScore, null);
      const accountProfileIconId = this.numberFrom(summoner.profileIconId, current.profileIconId);
      const chatIconId = this.numberFrom(chat && chat.icon, null);
      const hovercardIconId = chatIconId === null
        ? await this.readHovercardProfileIcon(summoner)
        : null;
      const profileIconId = this.firstKnownNumber(chatIconId, hovercardIconId, accountProfileIconId);
      const backgroundSkinId = this.numberFrom(profile.backgroundSkinId, current.backgroundSkinId);
      const sameProfileIcon = current.profileIconId === profileIconId;
      const sameBackground = current.backgroundSkinId === backgroundSkinId;

      const nextState: Partial<IdentityPreviewState> = {
        loaded: true,
        loading: false,
        error: '',
        updatedAt: new Date().toLocaleTimeString(),
        summonerName: this.stringFrom(summoner.gameName, this.stringFrom(summoner.displayName, current.summonerName || 'Summoner')),
        tagLine: this.stringFrom(summoner.tagLine, current.tagLine),
        profileIconId,
        profileIconName: sameProfileIcon ? current.profileIconName : 'Icon',
        profileIconUrl: this.profileIconUrl(profileIconId),
        chatRankTier: current.challengeSpoofActive ? current.chatRankTier : this.stringFrom(lol.rankedLeagueTier, current.chatRankTier),
        chatRankDivision: current.challengeSpoofActive ? current.chatRankDivision : this.stringFrom(lol.rankedLeagueDivision, current.chatRankDivision),
        chatRankQueue: current.challengeSpoofActive ? current.chatRankQueue : this.stringFrom(lol.rankedLeagueQueue, current.chatRankQueue),
        challengeCrystalLevel: current.challengeSpoofActive ? current.challengeCrystalLevel : this.stringFrom(summaryLevel, this.stringFrom(lol.challengeCrystalLevel, current.challengeCrystalLevel)),
        challengePoints: current.challengeSpoofActive ? current.challengePoints : this.numberFrom(summaryPoints, this.numberFrom(lol.challengePoints, current.challengePoints)),
        backgroundSkinId,
        backgroundImageUrl: sameBackground ? current.backgroundImageUrl : '',
        backgroundLabel: sameBackground ? current.backgroundLabel : (backgroundSkinId ? `Skin ${backgroundSkinId}` : '')
      };

      this.patchState(nextState);
      setTimeout(() => {
        void this.resolvePreviewDetails(profileIconId, backgroundSkinId);
      }, 250);
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
      backgroundLabel: backgroundSkinId ? `Skin ${backgroundSkinId}` : '',
      updatedAt: new Date().toLocaleTimeString()
    });
    this.resolveBackground(backgroundSkinId).then(background => {
      if (this.stateSubject.value.backgroundSkinId !== backgroundSkinId) return;
      this.patchState({
        backgroundImageUrl: background.url,
        backgroundLabel: background.label
      });
    });
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
        backgroundLabel: background.label
      });
    } catch (error) {
      console.warn('[Preview] metadata unavailable', error);
    }
  }

  private patchState(patch: Partial<IdentityPreviewState>) {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch
    });
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

  private async resolveBackground(backgroundSkinId: number | null): Promise<{url: string; label: string}> {
    if (!backgroundSkinId && backgroundSkinId !== 0) return {url: '', label: ''};
    if (backgroundSkinId === 0) return {url: '', label: 'Default'};

    try {
      await this.ensureChampionMap();
      const championKey = Math.floor(backgroundSkinId / 1000);
      const skinNumber = backgroundSkinId % 1000;
      const championId = this.championIdByKey[championKey];
      if (!championId) return {url: '', label: `Skin ${backgroundSkinId}`};

      return {
        url: `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championId}_${skinNumber}.jpg`,
        label: `${championId} skin ${skinNumber}`
      };
    } catch (error) {
      console.warn('[Preview] background metadata unavailable', error);
      return {url: '', label: `Skin ${backgroundSkinId}`};
    }
  }

  private async ensureChampionMap(): Promise<void> {
    if (Object.keys(this.championIdByKey).length > 0) return;
    await this.ensureVersion();
    if (!this.dataDragonVersion) return;

    const championPayload: any = await this.championService.getChampionIcons(this.dataDragonVersion).toPromise();
    const nextMap: Record<number, string> = {};
    Object.keys(championPayload.data || {}).forEach(championId => {
      const champion = championPayload.data[championId];
      const key = Number(champion && champion.key);
      if (!isNaN(key)) nextMap[key] = championId;
    });
    this.championIdByKey = nextMap;
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

    const icons: any = await this.championService.getSummonerIcons().toPromise();
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
    const versions = await this.versionService.apiVersion().toPromise() as string[];
    this.dataDragonVersion = versions && versions.length ? versions[0] : '';
  }

  private profileIconUrl(profileIconId: number | null): string {
    if (profileIconId === undefined || profileIconId === null || isNaN(profileIconId)) return '';
    return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${profileIconId}.jpg`;
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
