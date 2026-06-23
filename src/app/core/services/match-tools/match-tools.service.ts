import {Injectable, OnDestroy} from '@angular/core';
import {BehaviorSubject, firstValueFrom, Observable, Subscription} from 'rxjs';
import {LCUConnectionService} from '../lcuconnection/lcuconnection.service';
import {LcuEventsService, LcuJsonApiEvent} from '../lcu-events/lcu-events.service';
import {ChampionService} from '../champion/champion.service';
import {VersionService} from '../version/version.service';
import {IMatchupProvider, LaneMatchupResult, LolalyticsMatchupProvider} from './matchup-provider';

export type ReadyCheckStatus = 'Idle' | 'Searching' | 'Ready Check' | 'Accepted';

export interface ChampionCard {
  championId: number;
  championName: string;
  iconUrl: string;
}

interface ChampionMetadata {
  name: string;
  imageFull: string;
  tags: string[];
  info: {
    attack?: number;
    defense?: number;
    magic?: number;
  };
}

interface LaneOpponentResult {
  championId: number | null;
  isFallback: boolean;
  candidateIds: number[];
  source: 'assigned' | 'recommended' | 'class' | 'manual' | 'none';
}

interface LaneOpponentScore {
  championId: number;
  score: number;
  source: 'recommended' | 'class';
}

export interface ChampSelectViewState {
  inChampSelect: boolean;
  phase: string;
  localCellId: number | null;
  role: string;
  roleSource: 'assigned' | 'recommended' | 'none';
  playerChampionId: number | null;
  playerChampionName: string;
  playerChampionIconUrl: string;
  hoveredChampionId: number | null;
  hoveredChampionName: string;
  lockedChampionId: number | null;
  lockedChampionName: string;
  enemyChampionId: number | null;
  enemyChampionName: string;
  enemyChampionIconUrl: string;
  enemyMatchupLabel: string;
  enemyMatchupFallback: boolean;
  enemyMatchupSource: string;
  manualOpponentChampionId: number | null;
  possibleLaneOpponents: ChampionCard[];
  visibleEnemies: ChampionCard[];
  status: string;
}

export interface MatchToolsState {
  autoAcceptEnabled: boolean;
  readyCheckStatus: ReadyCheckStatus;
  readyCheckMessage: string;
  lastAcceptedAt: string;
  providerId: string;
  champSelect: ChampSelectViewState;
  matchup: LaneMatchupResult | null;
}

interface ChampSelectMember {
  cellId?: number;
  championId?: number;
  championPickIntent?: number;
  assignedPosition?: string;
  selectedSkinId?: number;
}

interface RecommendedChampionPositionPayload {
  recommendedPositions?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class MatchToolsService implements OnDestroy {
  private readonly defaultChampSelect: ChampSelectViewState = {
    inChampSelect: false,
    phase: '',
    localCellId: null,
    role: '',
    roleSource: 'none',
    playerChampionId: null,
    playerChampionName: '',
    playerChampionIconUrl: '',
    hoveredChampionId: null,
    hoveredChampionName: '',
    lockedChampionId: null,
    lockedChampionName: '',
    enemyChampionId: null,
    enemyChampionName: '',
    enemyChampionIconUrl: '',
    enemyMatchupLabel: 'Waiting for lane opponent...',
    enemyMatchupFallback: false,
    enemyMatchupSource: 'none',
    manualOpponentChampionId: null,
    possibleLaneOpponents: [],
    visibleEnemies: [],
    status: 'Not in champ select'
  };

  private readonly defaultState: MatchToolsState = {
    autoAcceptEnabled: false,
    readyCheckStatus: 'Idle',
    readyCheckMessage: '',
    lastAcceptedAt: '',
    providerId: 'lolalytics',
    champSelect: {...this.defaultChampSelect},
    matchup: null
  };

  private readonly stateSubject = new BehaviorSubject<MatchToolsState>({...this.defaultState});
  private readonly providers: IMatchupProvider[] = [new LolalyticsMatchupProvider()];
  private readonly autoAcceptDelayMs = 750;
  private readonly autoAcceptRetryCooldownMs = 2500;
  private eventSubscription: Subscription;
  private eventStateSubscription: Subscription;
  private acceptedStatusTimer: ReturnType<typeof setTimeout> | null = null;
  private autoAcceptTimer: ReturnType<typeof setTimeout> | null = null;
  private accepting = false;
  private acceptedResponseSuppressUntil = 0;
  private lastAutoAcceptAttemptAt = 0;
  private lastEventConnectionState = false;
  private bootstrapInFlight = false;
  private lastMatchupKey = '';
  private championNameById: Record<number, string> = {};
  private championSlugById: Record<number, string> = {};
  private championMetadataById: Record<number, ChampionMetadata> = {};
  private championMetadataPromise: Promise<void> | null = null;
  private recommendedPositionsByChampionId: Record<number, string[]> = {};
  private recommendedPositionsPromise: Promise<void> | null = null;
  private lastChampSelectSession: any = null;
  private dataDragonVersion = '';

  public readonly state$: Observable<MatchToolsState> = this.stateSubject.asObservable();
  public readonly matchupProviders = this.providers.map(provider => ({id: provider.id, label: provider.label}));

  constructor(
    private lcuConnectionService: LCUConnectionService,
    private lcuEventsService: LcuEventsService,
    private championService: ChampionService,
    private versionService: VersionService
  ) {
    this.eventSubscription = this.lcuEventsService.events$.subscribe(event => this.handleLcuEvent(event));
    this.eventStateSubscription = this.lcuEventsService.state$.subscribe(state => {
      const justConnected = state.connected && !this.lastEventConnectionState;
      this.lastEventConnectionState = state.connected;
      if (justConnected) this.bootstrapCurrentState();
      if (!state.connected) this.resetChampSelect('');
    });
  }

  ngOnDestroy(): void {
    this.eventSubscription.unsubscribe();
    this.eventStateSubscription.unsubscribe();
    this.clearAcceptedStatusTimer();
    this.clearAutoAcceptTimer();
  }

  public setAutoAccept(enabled: boolean): void {
    if (!enabled) {
      this.clearAcceptedStatusTimer();
      this.clearAutoAcceptTimer();
    }
    this.patchState({
      autoAcceptEnabled: enabled,
      readyCheckStatus: enabled ? this.stateSubject.value.readyCheckStatus : 'Idle',
      readyCheckMessage: '',
      lastAcceptedAt: enabled ? this.stateSubject.value.lastAcceptedAt : ''
    });
  }

  public setProvider(providerId: string): void {
    if (!this.providers.some(provider => provider.id === providerId)) return;
    this.lastMatchupKey = '';
    this.patchState({providerId});
    this.updateMatchup(this.stateSubject.value.champSelect).catch(() => undefined);
  }

  public selectManualOpponent(championId: number): void {
    const selectedChampionId = this.numberOrNull(championId);
    if (!selectedChampionId) return;
    const current = this.stateSubject.value.champSelect;
    if (!current.visibleEnemies.some(enemy => enemy.championId === selectedChampionId)) return;

    this.patchState({
      champSelect: {
        ...current,
        manualOpponentChampionId: selectedChampionId
      }
    });
    this.applyManualOpponent(selectedChampionId);
  }

  public clearManualOpponent(): void {
    const current = this.stateSubject.value.champSelect;
    this.patchState({
      champSelect: {
        ...current,
        manualOpponentChampionId: null
      }
    });
    if (this.lastChampSelectSession) this.applyChampSelectSession(this.lastChampSelectSession).catch(() => undefined);
  }

  private handleLcuEvent(event: LcuJsonApiEvent) {
    if (!event || !event.uri) return;

    if (event.uri === '/lol-gameflow/v1/gameflow-phase') {
      this.applyGameflowPhase(String(event.data || ''));
      return;
    }

    if (event.uri === '/lol-matchmaking/v1/ready-check') {
      this.applyReadyCheck(event.data);
      return;
    }

    if (event.uri === '/lol-champ-select/v1/session') {
      if (!this.shouldApplyChampSelectSessionEvent(event)) {
        if (this.stateSubject.value.champSelect.inChampSelect) {
          this.resetChampSelect(this.stateSubject.value.champSelect.phase);
        }
        return;
      }

      this.applyChampSelectSession(event.data).catch(() => undefined);
    }
  }

  private async bootstrapCurrentState() {
    if (this.bootstrapInFlight) return;
    this.bootstrapInFlight = true;
    try {
      await this.refreshGameflow();
      const currentPhase = this.stateSubject.value.champSelect.phase;
      if (currentPhase && currentPhase !== 'ChampSelect') {
        this.ensureChampionNames().catch(() => undefined);
        this.ensureRecommendedChampionPositions().catch(() => undefined);
      }
    } finally {
      this.bootstrapInFlight = false;
    }
  }

  private async acceptReadyCheck() {
    if (this.accepting || !this.shouldAcceptReadyCheckNow()) return;
    this.accepting = true;
    this.lastAutoAcceptAttemptAt = Date.now();
    try {
      const response = await this.lcuConnectionService.requestCustomAPI({}, 'POST', '/lol-matchmaking/v1/ready-check/accept');
      const responseText = String(response || '');
      if (responseText.toLowerCase().indexOf('failed') >= 0) {
        this.patchState({
          readyCheckStatus: 'Ready Check',
          readyCheckMessage: 'Auto Accept request failed'
        });
        return;
      }

      if (response === 'Success' || response === '') {
        this.acceptedResponseSuppressUntil = Date.now() + 10000;
        this.patchState({
          readyCheckStatus: 'Accepted',
          readyCheckMessage: 'Ready check accepted',
          lastAcceptedAt: new Date().toLocaleTimeString()
        });
        this.scheduleAcceptedStatusClear();
        return;
      }

      this.patchState({
        readyCheckStatus: 'Ready Check',
        readyCheckMessage: 'Auto Accept request failed'
      });
    } catch (error) {
      if (this.stateSubject.value.readyCheckStatus === 'Ready Check') {
        this.patchState({
          readyCheckStatus: 'Ready Check',
          readyCheckMessage: 'Auto Accept request failed'
        });
      }
    } finally {
      this.accepting = false;
    }
  }

  private applyReadyCheck(readyCheck: any) {
    if (!readyCheck || typeof readyCheck !== 'object') return;
    const state = String(readyCheck.state || '').toLowerCase();
    const playerResponse = String(readyCheck.playerResponse || '').toLowerCase();

    if (state === 'inprogress') {
      this.acceptedResponseSuppressUntil = 0;
      this.patchState({
        readyCheckStatus: 'Ready Check',
        readyCheckMessage: ''
      });
      if (playerResponse === 'accepted') {
        this.clearAutoAcceptTimer();
        return;
      }
      if (this.isAutoAcceptModeEnabled()) this.scheduleAutoAccept();
      return;
    }

    if (state === 'everyone_ready' || state === 'everyoneready' || playerResponse === 'accepted') {
      this.clearAutoAcceptTimer();
      if (Date.now() < this.acceptedResponseSuppressUntil && this.stateSubject.value.readyCheckStatus !== 'Accepted') return;
      if (this.stateSubject.value.readyCheckStatus === 'Accepted') return;
      this.acceptedResponseSuppressUntil = Date.now() + 10000;
      this.patchState({
        readyCheckStatus: 'Accepted',
        readyCheckMessage: 'Ready check accepted'
      });
      this.scheduleAcceptedStatusClear();
      return;
    }

    const phase = this.stateSubject.value.champSelect.phase;
    this.clearAutoAcceptTimer();
    this.patchState({
      readyCheckStatus: phase === 'Matchmaking' ? 'Searching' : 'Idle',
      readyCheckMessage: ''
    });
  }

  private scheduleAutoAccept() {
    if (this.autoAcceptTimer || this.accepting) return;

    const retryDelay = Math.max(0, this.autoAcceptRetryCooldownMs - (Date.now() - this.lastAutoAcceptAttemptAt));
    const delay = Math.max(this.autoAcceptDelayMs, retryDelay);
    this.autoAcceptTimer = setTimeout(() => {
      this.autoAcceptTimer = null;
      this.acceptReadyCheck().catch(() => undefined);
    }, delay);
  }

  private shouldAcceptReadyCheckNow(): boolean {
    const state = this.stateSubject.value;
    return state.autoAcceptEnabled && state.readyCheckStatus === 'Ready Check';
  }

  private isAutoAcceptModeEnabled(): boolean {
    return this.stateSubject.value.autoAcceptEnabled;
  }

  private async refreshGameflow() {
    const response = await this.lcuConnectionService.requestCustomAPI({}, 'GET', '/lol-gameflow/v1/gameflow-phase');
    const phase = this.parseResponse(response);
    if (typeof phase === 'string') this.applyGameflowPhase(phase);
  }

  private applyGameflowPhase(phase: string) {
    const previousChampSelect = this.stateSubject.value.champSelect;

    const nextChampSelect = {
      ...previousChampSelect,
      phase
    };

    if (this.shouldClearReadyStatusForPhase(phase)) {
      this.clearAcceptedStatusTimer();
      this.clearAutoAcceptTimer();
      this.patchState({
        readyCheckStatus: 'Idle',
        readyCheckMessage: '',
        lastAcceptedAt: ''
      });
    }

    if (phase !== 'ChampSelect') {
      this.resetChampSelect(phase);
      if (phase) {
        this.ensureChampionNames().catch(() => undefined);
        this.ensureRecommendedChampionPositions().catch(() => undefined);
      }
      this.patchState({
        readyCheckStatus: phase === 'Matchmaking' ? 'Searching' : this.stateSubject.value.readyCheckStatus,
        readyCheckMessage: ''
      });
      return;
    }

    this.patchState({
      champSelect: {
        ...nextChampSelect,
        inChampSelect: true,
        status: 'Champ select active'
      }
    });
  }

  private resetChampSelect(phase: string) {
    this.lastMatchupKey = '';
    this.lastChampSelectSession = null;
    this.patchState({
      champSelect: {
        ...this.defaultChampSelect,
        phase
      },
      matchup: null
    });
  }

  private async applyChampSelectSession(session: any) {
    if (!this.isActiveChampSelectSession(session)) return;
    this.lastChampSelectSession = session;
    await this.ensureChampionNames();
    if (this.stateSubject.value.champSelect.phase !== 'ChampSelect') return;

    const localCellId = this.cellIdOrNull(session.localPlayerCellId);
    const myTeam = Array.isArray(session.myTeam) ? session.myTeam as ChampSelectMember[] : [];
    const theirTeam = Array.isArray(session.theirTeam) ? session.theirTeam as ChampSelectMember[] : [];
    const localMember = this.findLocalMember(myTeam, localCellId);
    const lockedChampionId = this.numberOrNull(localMember.championId);
    const pickIntentChampionId = this.numberOrNull(localMember.championPickIntent);
    const hoveredChampionId = pickIntentChampionId || this.findHoveredChampionId(session, localCellId, lockedChampionId);
    const playerChampionId = lockedChampionId || pickIntentChampionId || hoveredChampionId;
    const roleContext = this.resolveLocalRole(localMember.assignedPosition, playerChampionId);
    const localRole = roleContext.role;
    const visibleEnemies = theirTeam
      .map(member => this.memberChampionId(member))
      .filter((id): id is number => !!id)
      .map(id => this.championCard(id));
    const currentManualOpponent = this.stateSubject.value.champSelect.manualOpponentChampionId;
    const manualOpponentChampionId = visibleEnemies.some(enemy => enemy.championId === currentManualOpponent)
      ? currentManualOpponent
      : null;
    const laneOpponent = this.findLaneOpponent(theirTeam, localRole, manualOpponentChampionId);
    const enemyChampionId = laneOpponent.championId;
    const enemyChampionName = this.championName(enemyChampionId);
    const possibleLaneOpponents = laneOpponent.candidateIds.map(id => this.championCard(id));

    const champSelect: ChampSelectViewState = {
      inChampSelect: true,
      phase: 'ChampSelect',
      localCellId,
      role: localRole,
      roleSource: roleContext.source,
      playerChampionId,
      playerChampionName: this.championName(playerChampionId),
      playerChampionIconUrl: this.championIconUrl(playerChampionId),
      hoveredChampionId,
      hoveredChampionName: this.championName(hoveredChampionId),
      lockedChampionId,
      lockedChampionName: this.championName(lockedChampionId),
      enemyChampionId,
      enemyChampionName,
      enemyChampionIconUrl: this.championIconUrl(enemyChampionId),
      enemyMatchupLabel: this.laneOpponentLabel(enemyChampionName, possibleLaneOpponents, laneOpponent),
      enemyMatchupFallback: laneOpponent.isFallback,
      enemyMatchupSource: laneOpponent.source,
      manualOpponentChampionId,
      possibleLaneOpponents,
      visibleEnemies,
      status: 'Champ select active'
    };

    this.patchState({champSelect});
    this.updateMatchup(champSelect).catch(() => undefined);
  }

  private findHoveredChampionId(session: any, localCellId: number, lockedChampionId: number): number | null {
    if (lockedChampionId) return lockedChampionId;
    if (localCellId === null || localCellId === undefined) return null;
    const actions = Array.isArray(session.actions) ? session.actions : [];
    for (const actionGroup of actions) {
      const action = Array.isArray(actionGroup)
        ? actionGroup.find(item => item && item.actorCellId === localCellId && item.type === 'pick' && item.championId)
        : null;
      if (action) return this.numberOrNull(action.championId);
    }
    return null;
  }

  private findLaneOpponent(theirTeam: ChampSelectMember[], localRole: string, manualOpponentChampionId: number | null): LaneOpponentResult {
    if (manualOpponentChampionId) {
      return {
        championId: manualOpponentChampionId,
        isFallback: false,
        candidateIds: [manualOpponentChampionId],
        source: 'manual'
      };
    }

    const normalizedLocalRole = this.normalizeRole(localRole);
    if (normalizedLocalRole && normalizedLocalRole !== 'Unknown') {
      const directOpponent = theirTeam.find(member => {
        const enemyRole = this.normalizeRole(member.assignedPosition);
        return enemyRole === normalizedLocalRole && this.memberChampionId(member);
      });
      if (directOpponent) {
        const championId = this.memberChampionId(directOpponent);
        return {championId, isFallback: false, candidateIds: championId ? [championId] : [], source: 'assigned'};
      }
    }

    const visibleEnemyIds = theirTeam.map(member => this.memberChampionId(member)).filter((id): id is number => !!id);
    return this.inferLaneOpponentByScore(visibleEnemyIds, normalizedLocalRole);
  }

  private inferLaneOpponentByScore(championIds: number[], localRole: string): LaneOpponentResult {
    if (!localRole || localRole === 'Unknown' || !championIds.length) {
      return {championId: null, isFallback: false, candidateIds: [], source: 'none'};
    }

    const scored = championIds
      .map(championId => this.laneOpponentScore(championId, localRole))
      .filter(item => item.score >= this.minimumRoleScore(localRole));
    if (!scored.length) return {championId: null, isFallback: false, candidateIds: [], source: 'none'};

    const bestScore = Math.max(...scored.map(item => item.score));
    const best = scored
      .filter(item => bestScore - item.score <= this.scoreTieWindow(localRole))
      .sort((left, right) => right.score - left.score || left.championId - right.championId);
    const source = best.some(item => item.source === 'recommended') ? 'recommended' : 'class';
    const candidateIds = best.map(item => item.championId);

    if (candidateIds.length === 1) {
      return {championId: candidateIds[0], isFallback: true, candidateIds, source};
    }
    return {championId: null, isFallback: true, candidateIds, source};
  }

  private laneOpponentScore(championId: number, localRole: string): LaneOpponentScore {
    const recommendedScore = this.recommendedPositionScore(championId, localRole);
    const classScore = this.roleScore(championId, localRole);
    if (recommendedScore > 0) {
      return {
        championId,
        score: recommendedScore * 10 + Math.max(classScore, 0),
        source: 'recommended'
      };
    }

    return {
      championId,
      score: classScore,
      source: 'class'
    };
  }

  private recommendedPositionScore(championId: number, localRole: string): number {
    const recommendedPositions = this.recommendedPositionsByChampionId[championId] || [];
    const normalizedLocalRole = this.normalizeRole(localRole);
    const index = recommendedPositions.findIndex(position => this.normalizeRole(position) === normalizedLocalRole);
    if (index < 0) return 0;
    return 100 - index;
  }

  private roleScore(championId: number, role: string): number {
    const metadata = this.championMetadataById[championId];
    if (!metadata) return 0;

    const tags = metadata.tags.map(tag => String(tag || '').toUpperCase());
    const info = metadata.info || {};
    const has = (tag: string) => tags.indexOf(tag) >= 0;
    const attack = Number(info.attack || 0);
    const defense = Number(info.defense || 0);
    const magic = Number(info.magic || 0);
    const normalizedRole = this.normalizeRole(role);

    if (normalizedRole === 'TOP') {
      return 0
        + (has('FIGHTER') ? 5 : 0)
        + (has('TANK') ? 3 : 0)
        + (has('MAGE') && has('FIGHTER') ? 4 : 0)
        + (defense >= 7 ? 1 : 0)
        + (magic >= 7 && has('FIGHTER') ? 3 : 0)
        + (attack >= 6 ? 1 : 0)
        - (has('TANK') && has('FIGHTER') && attack <= 5 && magic <= 6 ? 3 : 0)
        - (has('TANK') && !has('FIGHTER') ? 2 : 0)
        - (has('MARKSMAN') ? 3 : 0)
        - (has('SUPPORT') ? 2 : 0)
        - (has('MAGE') && !has('FIGHTER') && !has('TANK') ? 1 : 0);
    }

    if (normalizedRole === 'JUNGLE') {
      return 0
        + (has('FIGHTER') ? 4 : 0)
        + (has('ASSASSIN') ? 4 : 0)
        + (has('TANK') ? 3 : 0)
        + (defense >= 6 ? 1 : 0)
        + (attack >= 6 ? 1 : 0)
        - (has('MARKSMAN') ? 2 : 0)
        - (has('SUPPORT') ? 2 : 0)
        - (has('MAGE') && !has('FIGHTER') && !has('ASSASSIN') ? 1 : 0);
    }

    if (normalizedRole === 'MIDDLE') {
      return 0
        + (has('MAGE') ? 4 : 0)
        + (has('ASSASSIN') ? 4 : 0)
        + (magic >= 6 ? 2 : 0)
        + (attack >= 7 && has('ASSASSIN') ? 1 : 0)
        - (has('TANK') && !has('MAGE') && !has('ASSASSIN') ? 2 : 0)
        - (has('SUPPORT') ? 2 : 0);
    }

    if (normalizedRole === 'BOTTOM') {
      return 0
        + (has('MARKSMAN') ? 6 : 0)
        + (attack >= 7 ? 2 : 0)
        - (!has('MARKSMAN') && has('TANK') ? 3 : 0)
        - (!has('MARKSMAN') && has('FIGHTER') ? 3 : 0)
        - (has('SUPPORT') ? 2 : 0);
    }

    if (normalizedRole === 'SUPPORT') {
      return 0
        + (has('SUPPORT') ? 6 : 0)
        + (has('TANK') ? 3 : 0)
        + (has('MAGE') ? 2 : 0)
        + (defense >= 7 ? 2 : 0)
        - (has('MARKSMAN') && !has('SUPPORT') ? 2 : 0);
    }

    return 0;
  }

  private resolveLocalRole(assignedPosition: string, championId: number | null): {role: string; source: 'assigned' | 'recommended' | 'none'} {
    const assignedRole = this.normalizeRole(assignedPosition);
    if (assignedRole && assignedRole !== 'Unknown') {
      return {role: assignedRole, source: 'assigned'};
    }

    const recommended = championId ? this.recommendedPositionsByChampionId[championId] || [] : [];
    const firstRecommended = recommended.length ? this.normalizeRole(recommended[0]) : '';
    if (firstRecommended && firstRecommended !== 'Unknown') {
      return {role: firstRecommended, source: 'recommended'};
    }

    return {role: 'Unknown', source: 'none'};
  }

  private minimumRoleScore(role: string): number {
    const normalizedRole = this.normalizeRole(role);
    if (normalizedRole === 'TOP') return 6;
    if (normalizedRole === 'JUNGLE') return 6;
    if (normalizedRole === 'MIDDLE') return 5;
    if (normalizedRole === 'BOTTOM') return 6;
    if (normalizedRole === 'SUPPORT') return 6;
    return 99;
  }

  private scoreTieWindow(role: string): number {
    return this.normalizeRole(role) === 'TOP' ? 0 : 1;
  }

  private laneOpponentLabel(enemyChampionName: string, candidates: ChampionCard[], laneOpponent: LaneOpponentResult): string {
    if (enemyChampionName) {
      if (laneOpponent.source === 'manual') return `Selected lane opponent: ${enemyChampionName}`;
      return laneOpponent.isFallback ? `Possible lane opponent: ${enemyChampionName}` : `Lane opponent: ${enemyChampionName}`;
    }

    if (candidates.length > 1) return 'Possible lane opponents';
    return 'Waiting for lane opponent...';
  }

  private async updateMatchup(champSelect: ChampSelectViewState) {
    const allyChampionId = champSelect.playerChampionId;
    if (!allyChampionId || !champSelect.enemyChampionId) {
      this.lastMatchupKey = '';
      this.patchState({matchup: null});
      return;
    }

    const matchupKey = [
      this.stateSubject.value.providerId,
      allyChampionId,
      champSelect.enemyChampionId,
      champSelect.role
    ].join(':');
    if (this.lastMatchupKey === matchupKey && this.stateSubject.value.matchup) return;
    this.lastMatchupKey = matchupKey;

    const provider = this.providers.find(item => item.id === this.stateSubject.value.providerId) || this.providers[0];
    const matchup = await provider.getLaneMatchup({
      allyChampionId,
      allyChampionName: this.championName(allyChampionId),
      allyChampionSlug: this.championSlug(allyChampionId),
      enemyChampionId: champSelect.enemyChampionId,
      enemyChampionName: champSelect.enemyChampionName,
      enemyChampionSlug: this.championSlug(champSelect.enemyChampionId),
      lane: champSelect.role
    });
    this.patchState({matchup: matchup && matchup.sourceUrl ? matchup : null});
  }

  private applyManualOpponent(championId: number) {
    const current = this.stateSubject.value.champSelect;
    const enemyChampionName = this.championName(championId);
    const champSelect: ChampSelectViewState = {
      ...current,
      enemyChampionId: championId,
      enemyChampionName,
      enemyChampionIconUrl: this.championIconUrl(championId),
      enemyMatchupLabel: `Selected lane opponent: ${enemyChampionName}`,
      enemyMatchupFallback: false,
      enemyMatchupSource: 'manual',
      possibleLaneOpponents: [this.championCard(championId)],
      manualOpponentChampionId: championId
    };

    this.patchState({champSelect});
    this.updateMatchup(champSelect).catch(() => undefined);
  }

  private shouldApplyChampSelectSessionEvent(event: LcuJsonApiEvent): boolean {
    if (!event || event.uri !== '/lol-champ-select/v1/session') return false;
    if (this.isDeleteEvent(event)) return false;
    if (!this.isActiveChampSelectSession(event.data)) return false;

    const currentPhase = this.stateSubject.value.champSelect.phase;
    if (currentPhase === 'ChampSelect') return true;
    return false;
  }

  private isDeleteEvent(event: LcuJsonApiEvent): boolean {
    return String(event && event.eventType || '').toLowerCase() === 'delete';
  }

  private isActiveChampSelectSession(session: any): boolean {
    if (!session || typeof session !== 'object' || this.isLcuErrorResponse(session)) return false;

    const hasLocalCell = this.cellIdOrNull(session.localPlayerCellId) !== null;
    const hasMyTeam = Array.isArray(session.myTeam) && session.myTeam.length > 0;
    const hasTheirTeam = Array.isArray(session.theirTeam) && session.theirTeam.length > 0;
    const hasActions = Array.isArray(session.actions) && session.actions.length > 0;

    return hasLocalCell || hasMyTeam || hasTheirTeam || hasActions;
  }

  private async ensureChampionNames(): Promise<void> {
    if (Object.keys(this.championNameById).length > 0) return;
    if (this.championMetadataPromise === null) {
      this.championMetadataPromise = this.loadChampionMetadata();
    }
    try {
      await this.championMetadataPromise;
    } catch (error) {
      this.championMetadataPromise = null;
    }
  }

  private async loadChampionMetadata(): Promise<void> {
    if (!this.dataDragonVersion) {
      const versions = await firstValueFrom(this.versionService.apiVersion());
      this.dataDragonVersion = versions && versions.length ? versions[0] : '';
    }
    if (!this.dataDragonVersion) return;

    const championPayload: any = await firstValueFrom(this.championService.getChampionIcons(this.dataDragonVersion));
    const nextMap: Record<number, string> = {};
    const nextSlugMap: Record<number, string> = {};
    const nextMetadata: Record<number, ChampionMetadata> = {};
    Object.keys(championPayload.data || {}).forEach(championAssetId => {
      const champion = championPayload.data[championAssetId];
      const key = Number(champion && champion.key);
      if (!isNaN(key)) {
        const displayName = this.displayChampionName(champion, championAssetId);
        nextMap[key] = displayName;
        nextSlugMap[key] = championAssetId;
        nextMetadata[key] = {
          name: displayName,
          imageFull: champion && champion.image && champion.image.full ? champion.image.full : `${championAssetId}.png`,
          tags: Array.isArray(champion && champion.tags) ? champion.tags : [],
          info: champion && champion.info ? champion.info : {}
        };
      }
    });
    this.championNameById = nextMap;
    this.championSlugById = nextSlugMap;
    this.championMetadataById = nextMetadata;
  }

  private async ensureRecommendedChampionPositions(): Promise<void> {
    if (this.stateSubject.value.champSelect.phase === 'ChampSelect') return;
    if (Object.keys(this.recommendedPositionsByChampionId).length > 0) return;
    if (this.recommendedPositionsPromise === null) {
      this.recommendedPositionsPromise = this.loadRecommendedChampionPositions();
    }
    await this.recommendedPositionsPromise;
  }

  private async loadRecommendedChampionPositions(): Promise<void> {
    if (this.stateSubject.value.champSelect.phase === 'ChampSelect') return;
    const response = await this.lcuConnectionService.requestCustomAPI({}, 'GET', '/lol-perks/v1/recommended-champion-positions');
    const payload = this.parseResponse(response) as Record<string, RecommendedChampionPositionPayload>;
    if (!payload || typeof payload !== 'object' || this.isLcuErrorResponse(payload)) return;

    const nextMap: Record<number, string[]> = {};
    Object.keys(payload).forEach(championIdKey => {
      const championId = Number(championIdKey);
      const entry = payload[championIdKey];
      const recommendedPositions = entry && Array.isArray(entry.recommendedPositions)
        ? entry.recommendedPositions.map(position => this.normalizeRole(position)).filter(position => position !== 'Unknown')
        : [];
      if (!isNaN(championId) && recommendedPositions.length) nextMap[championId] = recommendedPositions;
    });
    this.recommendedPositionsByChampionId = nextMap;
  }

  private championName(championId: number | null): string {
    if (!championId) return '';
    return this.championNameById[championId] || `Champion ${championId}`;
  }

  private championSlug(championId: number | null): string {
    if (!championId) return '';
    return this.championSlugById[championId] || this.championName(championId);
  }

  private championCard(championId: number): ChampionCard {
    return {
      championId,
      championName: this.championName(championId),
      iconUrl: this.championIconUrl(championId)
    };
  }

  private championIconUrl(championId: number | null): string {
    if (!championId || !this.dataDragonVersion || !this.championMetadataById[championId]) return '';
    return `https://ddragon.leagueoflegends.com/cdn/${this.dataDragonVersion}/img/champion/${this.championMetadataById[championId].imageFull}`;
  }

  private displayChampionName(champion: any, fallback: string): string {
    return String(champion && champion.name || fallback || '').trim();
  }

  private normalizeRole(role: string): string {
    const normalized = String(role || '').toUpperCase();
    if (normalized.indexOf('UTILITY') >= 0 || normalized.indexOf('SUPPORT') >= 0) return 'SUPPORT';
    if (normalized.indexOf('BOTTOM') >= 0 || normalized.indexOf('BOT') >= 0) return 'BOTTOM';
    if (normalized.indexOf('MIDDLE') >= 0 || normalized.indexOf('MID') >= 0) return 'MIDDLE';
    if (normalized.indexOf('JUNGLE') >= 0) return 'JUNGLE';
    if (normalized.indexOf('TOP') >= 0) return 'TOP';
    return normalized || 'Unknown';
  }

  private numberOrNull(value: unknown): number | null {
    const parsed = Number(value);
    return isNaN(parsed) || parsed <= 0 ? null : parsed;
  }

  private cellIdOrNull(value: unknown): number | null {
    const parsed = Number(value);
    return isNaN(parsed) || parsed < 0 ? null : parsed;
  }

  private findLocalMember(myTeam: ChampSelectMember[], localCellId: number | null): ChampSelectMember {
    if (localCellId !== null && localCellId !== undefined) {
      const exactMatch = myTeam.find(member => this.cellIdOrNull(member.cellId) === localCellId);
      if (exactMatch) return exactMatch;
    }
    return myTeam.length === 1 ? myTeam[0] : {};
  }

  private memberChampionId(member: ChampSelectMember): number | null {
    return this.numberOrNull(member && member.championId) || this.numberOrNull(member && member.championPickIntent);
  }

  private scheduleAcceptedStatusClear() {
    this.clearAcceptedStatusTimer();
    this.acceptedStatusTimer = setTimeout(() => {
      this.acceptedStatusTimer = null;
      if (this.stateSubject.value.readyCheckStatus !== 'Accepted') return;
      this.patchState({
        readyCheckStatus: 'Idle',
        readyCheckMessage: '',
        lastAcceptedAt: ''
      });
    }, 3500);
  }

  private clearAcceptedStatusTimer() {
    if (!this.acceptedStatusTimer) return;
    clearTimeout(this.acceptedStatusTimer);
    this.acceptedStatusTimer = null;
  }

  private clearAutoAcceptTimer() {
    if (!this.autoAcceptTimer) return;
    clearTimeout(this.autoAcceptTimer);
    this.autoAcceptTimer = null;
  }

  private shouldClearReadyStatusForPhase(phase: string): boolean {
    return ['ChampSelect', 'GameStart', 'InProgress', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame'].indexOf(phase) >= 0;
  }

  private parseResponse(response: any): any {
    if (typeof response !== 'string') return response;
    try {
      return JSON.parse(response);
    } catch (error) {
      return null;
    }
  }

  private isLcuErrorResponse(response: any): boolean {
    return !!response && typeof response === 'object' && (
      response.errorCode ||
      response.httpStatus ||
      response.message === 'RESOURCE_NOT_FOUND'
    );
  }

  private patchState(patch: Partial<MatchToolsState>) {
    const current = this.stateSubject.value;
    const next = {
      ...current,
      ...patch
    };
    const changed = (Object.keys(patch) as Array<keyof MatchToolsState>).some(key => current[key] !== next[key]);
    if (!changed) return;
    this.stateSubject.next(next);
  }
}
