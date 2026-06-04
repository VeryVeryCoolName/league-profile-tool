import {Injectable} from '@angular/core';
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
  lastAction: string;
  lastActionAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class PresenceAutomationService {
  private readonly defaultState: PresenceAutomationState = {
    originalCaptured: false,
    restoring: false,
    autoReapply: false,
    lastAction: '',
    lastActionAt: ''
  };

  private readonly stateSubject = new BehaviorSubject<PresenceAutomationState>({...this.defaultState});
  private connectorSubscription: Subscription;
  private eventSubscription: Subscription;
  private originalPresence: PresencePatch = null;
  private statusPatch: PresencePatch = null;
  private chatRankPatch: PresencePatch = null;
  private challengeRankPatch: PresencePatch = null;
  private lastReapplyAt = 0;
  private autoReapplySuppressedUntil = 0;

  public readonly state$: Observable<PresenceAutomationState> = this.stateSubject.asObservable();

  constructor(
    private connector: ConnectorService,
    private lcuConnectionService: LCUConnectionService,
    private lcuEventsService: LcuEventsService,
    private identityPreviewService: IdentityPreviewService
  ) {
    this.connectorSubscription = this.connector.ready$.subscribe(ready => {
      if (ready) this.captureOriginalPresence();
      if (!ready) this.resetRuntimeState('LCU disconnected');
    });
    this.eventSubscription = this.lcuEventsService.events$.subscribe(event => this.handleEvent(event));
  }

  public recordStatusPreset(availability: string, statusMessage: string): void {
    this.statusPatch = {availability, statusMessage};
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

    if (event.uri === '/lol-chat/v1/me' || event.uri.indexOf('/lol-lobby/') === 0 || event.uri === '/lol-gameflow/v1/gameflow-phase') {
      this.reapplyAfterRefresh(event);
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
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch
    });
  }

  private parseResponse(response: any): any {
    if (typeof response !== 'string') return response;
    try {
      return JSON.parse(response);
    } catch (error) {
      return null;
    }
  }
}
