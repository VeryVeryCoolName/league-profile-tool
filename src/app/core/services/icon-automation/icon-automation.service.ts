import {Injectable, OnDestroy} from '@angular/core';
import {BehaviorSubject, Observable, Subscription} from 'rxjs';
import {ConnectorService} from '../connector/connector.service';
import {LcuEventsService, LcuJsonApiEvent} from '../lcu-events/lcu-events.service';
import {IconApplyOutcome, ProfileIconService} from '../profile-icon/profile-icon.service';

export interface IconAutomationState {
  autoReapply: boolean;
  desiredIconId: number | null;
  lastAction: string;
  lastActionAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class IconAutomationService implements OnDestroy {
  private readonly defaultState: IconAutomationState = {
    autoReapply: false,
    desiredIconId: null,
    lastAction: '',
    lastActionAt: ''
  };

  private readonly storageKey = 'league-profile-tool:auto-reapply-icon';
  private readonly stateSubject = new BehaviorSubject<IconAutomationState>({...this.defaultState});
  private readonly connectorSubscription: Subscription;
  private readonly eventSubscription: Subscription;
  private readonly appliedSubscription: Subscription;
  private reapplyTimer: ReturnType<typeof setTimeout> | null = null;
  private reapplyInFlight = false;
  private lastAttemptAt = 0;
  private suppressedUntil = 0;
  private fightCount = 0;

  public readonly state$: Observable<IconAutomationState> = this.stateSubject.asObservable();

  constructor(
    private connector: ConnectorService,
    private lcuEventsService: LcuEventsService,
    private profileIconService: ProfileIconService
  ) {
    this.loadPreference();
    this.connectorSubscription = this.connector.ready$.subscribe(ready => {
      if (ready) {
        this.fightCount = 0;
        this.scheduleReapply();
        return;
      }
      this.clearReapplyTimer();
    });
    this.eventSubscription = this.lcuEventsService.events$.subscribe(event => this.handleEvent(event));
    this.appliedSubscription = this.profileIconService.applied$.subscribe(outcome => this.recordAppliedIcon(outcome));
  }

  ngOnDestroy(): void {
    this.connectorSubscription.unsubscribe();
    this.eventSubscription.unsubscribe();
    this.appliedSubscription.unsubscribe();
    this.clearReapplyTimer();
  }

  public setAutoReapply(enabled: boolean): void {
    if (!enabled) {
      this.clearReapplyTimer();
      this.clearPreference();
      this.patchState({autoReapply: false});
      this.markAction('Auto re-apply icon disabled');
      return;
    }

    this.fightCount = 0;
    this.patchState({autoReapply: true});
    this.savePreference();
    this.markAction('Auto re-apply icon enabled');
    this.scheduleReapply();
  }

  private recordAppliedIcon(outcome: IconApplyOutcome): void {
    if (!outcome.applied) return;
    this.suppressedUntil = Date.now() + 2500;
    this.fightCount = 0;
    if (this.stateSubject.value.desiredIconId === outcome.iconId) return;
    this.patchState({desiredIconId: outcome.iconId});
    if (this.stateSubject.value.autoReapply) this.savePreference();
  }

  private handleEvent(event: LcuJsonApiEvent): void {
    if (!event || !event.uri) return;
    const state = this.stateSubject.value;
    if (!state.autoReapply || state.desiredIconId === null) return;

    if (event.uri === '/lol-gameflow/v1/gameflow-phase') {
      this.fightCount = 0;
      this.scheduleReapply();
      return;
    }

    if (event.uri === '/lol-summoner/v1/current-summoner') {
      const iconId = this.numberOrNull(event.data && event.data.profileIconId);
      if (iconId !== null && iconId === state.desiredIconId) return;
      this.scheduleReapply();
      return;
    }

    if (event.uri === '/lol-chat/v1/me') {
      const iconId = this.numberOrNull(event.data && event.data.icon);
      if (iconId !== null && iconId === state.desiredIconId) return;
      this.scheduleReapply();
    }
  }

  private scheduleReapply(): void {
    const state = this.stateSubject.value;
    if (!state.autoReapply || state.desiredIconId === null) return;
    if (this.isSuppressed()) return;

    this.clearReapplyTimer();
    this.reapplyTimer = setTimeout(() => {
      this.reapplyTimer = null;
      void this.reapplyIfNeeded();
    }, 900);
  }

  private async reapplyIfNeeded(): Promise<void> {
    const state = this.stateSubject.value;
    if (!state.autoReapply || state.desiredIconId === null) return;
    if (!this.connector.isReady()) return;
    if (this.isSuppressed() || this.reapplyInFlight) return;
    if (this.fightCount >= 3) return;

    const now = Date.now();
    if (now - this.lastAttemptAt < 4500) return;
    this.lastAttemptAt = now;
    this.reapplyInFlight = true;

    try {
      const {accountIconId, chatIconId} = await this.profileIconService.readCurrentIconIds();
      const accountMatches = accountIconId === null || accountIconId === state.desiredIconId;
      const chatMatches = chatIconId === null || chatIconId === state.desiredIconId;
      if (accountMatches && chatMatches) {
        this.fightCount = 0;
        return;
      }

      this.fightCount++;
      const outcome = await this.profileIconService.applyIcon(state.desiredIconId);
      this.markAction(outcome.applied ? 'Reapplied profile icon' : 'Could not reapply profile icon');
    } catch (error) {
      this.markAction('Could not reapply profile icon');
    } finally {
      this.reapplyInFlight = false;
    }
  }

  private isSuppressed(): boolean {
    return Date.now() < this.suppressedUntil;
  }

  private clearReapplyTimer(): void {
    if (this.reapplyTimer === null) return;
    clearTimeout(this.reapplyTimer);
    this.reapplyTimer = null;
  }

  private markAction(lastAction: string): void {
    this.patchState({
      lastAction,
      lastActionAt: new Date().toLocaleTimeString()
    });
  }

  private patchState(patch: Partial<IconAutomationState>): void {
    const current = this.stateSubject.value;
    const next = {
      ...current,
      ...patch
    };
    const changed = (Object.keys(patch) as Array<keyof IconAutomationState>).some(key => current[key] !== next[key]);
    if (!changed) return;
    this.stateSubject.next(next);
  }

  private numberOrNull(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return isNaN(parsed) ? null : parsed;
  }

  private loadPreference(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.enabled) return;
      const iconId = this.numberOrNull(parsed.iconId);
      this.patchState({autoReapply: true, desiredIconId: iconId});
    } catch (error) {
      this.clearPreference();
    }
  }

  private savePreference(): void {
    const state = this.stateSubject.value;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({enabled: true, iconId: state.desiredIconId}));
    } catch (error) {
    }
  }

  private clearPreference(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
    }
  }
}
