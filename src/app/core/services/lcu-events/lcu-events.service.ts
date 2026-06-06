import {Injectable, OnDestroy} from '@angular/core';
import {BehaviorSubject, Observable, Subject, Subscription} from 'rxjs';
import {ConnectorService} from '../connector/connector.service';
import {ElectronService} from '../electron/electron.service';

export interface LcuJsonApiEvent {
  uri: string;
  eventType: string;
  data: any;
}

export interface LcuEventState {
  connected: boolean;
  connecting: boolean;
  gameflowPhase: string;
  lastEventUri: string;
  lastEventType: string;
  lastEventAt: string;
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class LcuEventsService implements OnDestroy {
  private readonly defaultState: LcuEventState = {
    connected: false,
    connecting: false,
    gameflowPhase: '',
    lastEventUri: '',
    lastEventType: '',
    lastEventAt: '',
    message: 'Waiting for LCU connection'
  };

  private readonly stateSubject = new BehaviorSubject<LcuEventState>({...this.defaultState});
  private readonly eventSubject = new Subject<LcuJsonApiEvent>();
  private readonly connectorSubscription: Subscription;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionActive = false;
  private manuallyClosed = false;

  public readonly state$: Observable<LcuEventState> = this.stateSubject.asObservable();
  public readonly events$: Observable<LcuJsonApiEvent> = this.eventSubject.asObservable();

  constructor(private connector: ConnectorService, private electronService: ElectronService) {
    this.connectorSubscription = this.connector.ready$.subscribe(ready => {
      if (ready) {
        this.manuallyClosed = false;
        void this.connect();
      } else {
        void this.closeConnection('LCU disconnected');
      }
    });
  }

  ngOnDestroy(): void {
    this.connectorSubscription.unsubscribe();
    void this.closeConnection('Application closed');
  }

  public async connect(): Promise<void> {
    if (!this.electronService.isElectron || !this.connector.connector || this.connectionActive || this.stateSubject.value.connecting) {
      return;
    }

    this.clearReconnectTimer();
    this.patchState({connecting: true, message: 'Connecting to LCU events'});
    const authorization = this.connector.connector.headers?.Authorization;

    try {
      await this.electronService.connectLcuEvents(
        {url: this.connector.connector.url, authorization},
        event => this.handleBridgeEvent(event),
        state => this.handleBridgeState(state)
      );
      this.connectionActive = true;
    } catch (error) {
      this.handleDisconnected(`Could not connect event socket: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private handleBridgeState(state: {connected: boolean; message: string}): void {
    this.connectionActive = state.connected;
    this.patchState({
      connected: state.connected,
      connecting: false,
      message: state.message
    });
    if (!state.connected && !this.manuallyClosed && this.connector.isReady()) this.scheduleReconnect();
  }

  private handleBridgeEvent(value: unknown): void {
    const event = value as LcuJsonApiEvent;
    if (!event || typeof event.uri !== 'string') return;

    const patch: Partial<LcuEventState> = {
      lastEventUri: event.uri,
      lastEventType: event.eventType || '',
      lastEventAt: new Date().toLocaleTimeString()
    };
    if (event.uri === '/lol-gameflow/v1/gameflow-phase') {
      patch.gameflowPhase = String(event.data || '');
    }
    this.patchState(patch);
    this.eventSubject.next(event);
  }

  private handleDisconnected(message: string): void {
    this.connectionActive = false;
    this.patchState({connected: false, connecting: false, message});
    if (!this.manuallyClosed && this.connector.isReady()) this.scheduleReconnect();
  }

  private async closeConnection(message: string): Promise<void> {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.connectionActive = false;
    await this.electronService.disconnectLcuEvents();
    this.patchState({connected: false, connecting: false, message});
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, 5000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private patchState(patch: Partial<LcuEventState>): void {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch
    });
  }
}
