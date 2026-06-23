import {Injectable, OnDestroy} from '@angular/core';
import {BehaviorSubject, Observable, Subscription} from 'rxjs';
import {ConnectorService} from '../connector/connector.service';
import {LCUConnectionService} from '../lcuconnection/lcuconnection.service';
import {LcuEventsService, LcuJsonApiEvent} from '../lcu-events/lcu-events.service';
import {IdentityPreviewService} from '../identity-preview/identity-preview.service';

interface PresencePatch {
  availability?: string;
  statusMessage?: string;
  lol?: Record<string, unknown>;
}

export interface PresenceAutomationState {
  originalCaptured: boolean;
  restoring: boolean;
  autoReapply: boolean;
  persistentInvisible: boolean;
  persistentInvisibleAvailability: string;
  lastAction: string;
  lastActionAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class PresenceAutomationService implements OnDestroy {
  private readonly defaultState: PresenceAutomationState = {
    originalCaptured: false,
    restoring: false,
    autoReapply: false,
    persistentInvisible: false,
    persistentInvisibleAvailability: '',
    lastAction: '',
    lastActionAt: ''
  };

  private readonly persistentInvisibleStorageKey = 'league-profile-tool:persistent-invisible';
  private readonly stateSubject = new BehaviorSubject<PresenceAutomationState>({...this.defaultState});
  private connectorSubscription: Subscription;
  private eventSubscription: Subscription;
  private originalPresence: PresencePatch = null;
  private statusPatch: PresencePatch = null;
  private chatRankPatch: PresencePatch = null;
  private challengeRankPatch: PresencePatch = null;
  private persistentInvisiblePatch: PresencePatch = null;
  private persistentInvisibleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReapplyAt = 0;
  private autoReapplySuppressedUntil = 0;
  private lastPersistentInvisibleAttemptAt = 0;
  private persistentInvisibleSuppressedUntil = 0;

  public readonly state$: Observable<PresenceAutomationState> = this.stateSubject.asObservable();

  constructor(
    private connector: ConnectorService,
    private lcuConnectionService: LCUConnectionService,
    private lcuEventsService: LcuEventsService,
    private identityPreviewService: IdentityPreviewService
  ) {
    this.loadPersistentInvisiblePreference();
    this.connectorSubscription = this.connector.ready$.subscribe(ready => {
      if (ready) {
        this.captureOriginalPresence();
        this.schedulePersistentInvisibleReapply();
      }
      if (!ready) this.resetRuntimeState('LCU disconnected');
    });
    this.eventSubscription = this.lcuEventsService.events$.subscribe(event => this.handleEvent(event));
  }

  ngOnDestroy(): void {
    this.connectorSubscription.unsubscribe();
    this.eventSubscription.unsubscribe();
    this.clearPersistentInvisibleTimer();
  }

  public recordStatusPreset(patch: PresencePatch): void {
    this.statusPatch = this.mergePatches(this.statusPatch, patch);
    this.markAction('Status preset captured');
  }

  public recordChatRankPreset(queue: string, tier: string, division: string): void {
    this.chatRankPatch = {
      lol: {
        rankedLeagueQueue: queue,
        rankedLeagueTier: tier,
        rankedLeagueDivision: division
      }
    };
    this.markAction('Chat rank preset captured');
  }

  public recordChallengeRankPreset(level: string, points: number): void {
    this.challengeRankPatch = {
      lol: {
        challengeCrystalLevel: level,
        challengePoints: String(points)
      }
    };
    this.markAction('Challenge rank preset captured');
  }

  public setAutoReapply(enabled: boolean): void {
    this.patchState({autoReapply: enabled});
  }

  public setPersistentInvisible(enabled: boolean, patch?: PresencePatch): void {
    if (!enabled) {
      this.persistentInvisiblePatch = null;
      this.persistentInvisibleSuppressedUntil = 0;
      this.clearPersistentInvisibleTimer();
      this.clearPersistentInvisiblePreference();
      this.patchState({persistentInvisible: false, persistentInvisibleAvailability: ''});
      this.markAction('Persistent invisible disabled');
      return;
    }

    const nextPatch = this.normalizePersistentInvisiblePatch(patch);
    this.persistentInvisiblePatch = nextPatch;
    this.persistentInvisibleSuppressedUntil = Date.now() + 2500;
    this.savePersistentInvisiblePreference(nextPatch);
    this.patchState({
      persistentInvisible: true,
      persistentInvisibleAvailability: nextPatch.availability || 'offline'
    });
    this.markAction('Persistent invisible enabled');
  }

  public clearPersistentInvisible(): void {
    this.setPersistentInvisible(false);
  }

  public suspendAutoReapply(durationMs = 5000): void {
    this.autoReapplySuppressedUntil = Date.now() + durationMs;
  }

  public async restoreOriginalPresence(): Promise<string> {
    if (!this.originalPresence) {
      await this.captureOriginalPresence();
      if (!this.originalPresence) return 'Original presence is not available yet.';
    }

    this.patchState({restoring: true});
    const response = await this.writePresence(this.originalPresence);
    this.patchState({restoring: false});
    if (response === 'Success') {
      this.identityPreviewService.clearChallengeSpoof();
      this.markAction('Original identity restored');
    }
    return response;
  }

  public async reapplyEnabledPresets(): Promise<void> {
    if (!this.stateSubject.value.autoReapply) return;
    if (this.isAutoReapplySuppressed()) return;
    const merged = this.mergePatches(this.statusPatch, this.chatRankPatch, this.challengeRankPatch);
    if (!merged) return;

    const response = await this.writePresence(merged);
    if (response === 'Success') this.markAction('Reapplied changes after client refresh');
  }

  private async captureOriginalPresence() {
    const response = await this.lcuConnectionService.requestCustomAPI({}, 'GET', '/lol-chat/v1/me');
    const current = this.parseResponse(response);
    if (!current) return;

    const lol = current.lol || {};
    this.originalPresence = {
      availability: current.availability,
      statusMessage: current.statusMessage,
      lol: {
        rankedLeagueQueue: lol.rankedLeagueQueue,
        rankedLeagueTier: lol.rankedLeagueTier,
        rankedLeagueDivision: lol.rankedLeagueDivision,
        challengeCrystalLevel: lol.challengeCrystalLevel,
        challengePoints: lol.challengePoints
      }
    };
    this.patchState({originalCaptured: true});
    this.markAction('Original identity captured');
  }

  private handleEvent(event: LcuJsonApiEvent) {
    if (!event || !event.uri) return;

    if (this.shouldWatchForPersistentInvisible(event.uri)) {
      this.schedulePersistentInvisibleReapply(event);
    }

    if (event.uri === '/lol-chat/v1/me' || event.uri.indexOf('/lol-lobby/') === 0 || event.uri === '/lol-gameflow/v1/gameflow-phase') {
      this.reapplyAfterRefresh(event);
    }
  }

  private schedulePersistentInvisibleReapply(event?: LcuJsonApiEvent): void {
    if (!this.persistentInvisiblePatch) return;
    if (this.isPersistentInvisibleSuppressed()) return;
    if (event && event.uri === '/lol-chat/v1/me' && this.matchesPatch(event.data, this.persistentInvisiblePatch)) return;

    this.clearPersistentInvisibleTimer();
    this.persistentInvisibleTimer = setTimeout(() => {
      this.persistentInvisibleTimer = null;
      void this.reapplyPersistentInvisibleIfNeeded(event);
    }, 900);
  }

  private async reapplyPersistentInvisibleIfNeeded(event?: LcuJsonApiEvent): Promise<void> {
    if (!this.persistentInvisiblePatch) return;
    if (this.isPersistentInvisibleSuppressed()) return;

    const now = Date.now();
    if (now - this.lastPersistentInvisibleAttemptAt < 4500) return;
    this.lastPersistentInvisibleAttemptAt = now;

    let current = event && event.uri === '/lol-chat/v1/me' ? event.data : null;
    if (!this.hasAvailability(current)) {
      const response = await this.lcuConnectionService.requestCustomAPI({}, 'GET', '/lol-chat/v1/me');
      current = this.parseResponse(response);
    }
    if (!current || this.matchesPatch(current, this.persistentInvisiblePatch)) return;

    const response = await this.writePresence(this.persistentInvisiblePatch);
    if (response === 'Success') {
      this.persistentInvisibleSuppressedUntil = Date.now() + 2500;
      this.markAction('Reapplied invisible status');
    } else {
      this.markAction('Could not reapply invisible status');
    }
  }

  private reapplyAfterRefresh(event?: LcuJsonApiEvent) {
    if (!this.stateSubject.value.autoReapply) return;
    if (this.isAutoReapplySuppressed()) return;
    const patch = this.mergePatches(this.statusPatch, this.chatRankPatch, this.challengeRankPatch);
    if (!patch) return;
    if (event && event.uri === '/lol-chat/v1/me' && this.matchesPatch(event.data, patch)) return;

    this.writeWithCooldown(patch, 'Reapplied changes after client refresh');
  }

  private async writeWithCooldown(patch: PresencePatch, action: string) {
    if (!patch) return;
    if (this.isAutoReapplySuppressed()) return;
    const now = Date.now();
    if (now - this.lastReapplyAt < 2500) return;
    this.lastReapplyAt = now;

    const response = await this.writePresence(patch);
    if (response === 'Success') this.markAction(action);
  }

  private async writePresence(patch: PresencePatch): Promise<string> {
    return await this.lcuConnectionService.requestSendNoVerify(patch as Record<string, unknown>, 'PUT', 'lolChat');
  }

  private mergePatches(...patches: PresencePatch[]): PresencePatch {
    const merged: PresencePatch = {};
    patches.filter(Boolean).forEach(patch => {
      if (patch.availability !== undefined) merged.availability = patch.availability;
      if (patch.statusMessage !== undefined) merged.statusMessage = patch.statusMessage;
      if (patch.lol) merged.lol = {...(merged.lol || {}), ...patch.lol};
    });

    if (!merged.lol && merged.availability === undefined && merged.statusMessage === undefined) return null;
    return merged;
  }

  private matchesPatch(current: any, patch: PresencePatch): boolean {
    if (!current || typeof current !== 'object') return false;
    if (patch.availability !== undefined && current.availability !== patch.availability) return false;
    if (patch.statusMessage !== undefined && current.statusMessage !== patch.statusMessage) return false;

    if (patch.lol) {
      const currentLol = current.lol || {};
      const matchesLol = Object.keys(patch.lol).every(key => {
        const expected = patch.lol[key];
        const actual = currentLol[key];
        if (key === 'challengePoints') return String(actual) === String(expected);
        if (typeof actual === 'string' && typeof expected === 'string' && this.shouldNormalizeCase(key)) {
          return actual.toUpperCase() === expected.toUpperCase();
        }
        return actual === expected;
      });
      if (!matchesLol) return false;
    }

    return true;
  }

  private shouldNormalizeCase(key: string): boolean {
    return ['rankedLeagueQueue', 'rankedLeagueTier', 'rankedLeagueDivision', 'challengeCrystalLevel'].indexOf(key) >= 0;
  }

  private isAutoReapplySuppressed(): boolean {
    return Date.now() < this.autoReapplySuppressedUntil;
  }

  private isPersistentInvisibleSuppressed(): boolean {
    return Date.now() < this.persistentInvisibleSuppressedUntil;
  }

  private resetRuntimeState(message: string) {
    this.originalPresence = null;
    this.patchState({
      originalCaptured: false,
      lastAction: message,
      lastActionAt: new Date().toLocaleTimeString()
    });
  }

  private markAction(lastAction: string) {
    this.patchState({
      lastAction,
      lastActionAt: new Date().toLocaleTimeString()
    });
  }

  private patchState(patch: Partial<PresenceAutomationState>) {
    const current = this.stateSubject.value;
    const next = {
      ...current,
      ...patch
    };
    const changed = (Object.keys(patch) as Array<keyof PresenceAutomationState>).some(key => current[key] !== next[key]);
    if (!changed) return;
    this.stateSubject.next(next);
  }

  private parseResponse(response: any): any {
    if (typeof response !== 'string') return response;
    try {
      return JSON.parse(response);
    } catch (error) {
      return null;
    }
  }

  private normalizePersistentInvisiblePatch(patch?: PresencePatch): PresencePatch {
    return {
      ...(this.persistentInvisiblePatch || {}),
      ...(patch || {}),
      availability: 'offline'
    };
  }

  private shouldWatchForPersistentInvisible(uri: string): boolean {
    return uri === '/lol-chat/v1/me'
      || uri === '/lol-gameflow/v1/gameflow-phase'
      || uri.indexOf('/lol-lobby/') === 0
      || uri.indexOf('/lol-champ-select/') === 0;
  }

  private hasAvailability(value: any): boolean {
    return !!(value && typeof value === 'object' && value.availability !== undefined);
  }

  private loadPersistentInvisiblePreference(): void {
    try {
      const raw = localStorage.getItem(this.persistentInvisibleStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.enabled || !parsed.patch) return;
      const patch = this.normalizePersistentInvisiblePatch(parsed.patch);
      this.persistentInvisiblePatch = patch;
      this.patchState({
        persistentInvisible: true,
        persistentInvisibleAvailability: patch.availability || 'offline'
      });
    } catch (error) {
      this.clearPersistentInvisiblePreference();
    }
  }

  private savePersistentInvisiblePreference(patch: PresencePatch): void {
    try {
      localStorage.setItem(this.persistentInvisibleStorageKey, JSON.stringify({enabled: true, patch}));
    } catch (error) {
      // Persistence is best-effort; live reapply still works for this session.
    }
  }

  private clearPersistentInvisiblePreference(): void {
    try {
      localStorage.removeItem(this.persistentInvisibleStorageKey);
    } catch (error) {
      // Ignore storage failures.
    }
  }

  private clearPersistentInvisibleTimer(): void {
    if (this.persistentInvisibleTimer === null) return;
    clearTimeout(this.persistentInvisibleTimer);
    this.persistentInvisibleTimer = null;
  }
}
