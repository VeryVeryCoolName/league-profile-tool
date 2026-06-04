import {Injectable} from '@angular/core';
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
export class LcuEventsService {
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
  private connectorSubscription: Subscription;
  private socket: any;
  private reconnectTimer: any;
  private frameBuffer: Buffer = null;
  private handshakeBuffer: Buffer = null;
  private handshakeComplete = false;
  private manuallyClosed = false;

  public readonly state$: Observable<LcuEventState> = this.stateSubject.asObservable();
  public readonly events$: Observable<LcuJsonApiEvent> = this.eventSubject.asObservable();

  constructor(private connector: ConnectorService, private electronService: ElectronService) {
    this.connectorSubscription = this.connector.ready$.subscribe(ready => {
      if (ready) {
        this.manuallyClosed = false;
        this.connect();
      } else {
        this.closeSocket('LCU disconnected');
      }
    });
  }

  public connect(): void {
    if (!this.electronService.isElectron || !this.connector.connector || this.socket || this.stateSubject.value.connecting) return;

    this.clearReconnectTimer();
    this.patchState({connecting: true, message: 'Connecting to LCU events'});

    try {
      const target = new URL(this.connector.connector.url);
      const socket = this.electronService.tls.connect({
        host: target.hostname,
        port: Number(target.port),
        rejectUnauthorized: false
      });
      this.socket = socket;
      this.handshakeComplete = false;
      this.handshakeBuffer = Buffer.alloc(0);
      this.frameBuffer = Buffer.alloc(0);

      socket.once('secureConnect', () => this.sendHandshake(target));
      socket.on('data', chunk => this.receiveData(chunk));
      socket.on('error', error => this.handleSocketClose(`Event socket error: ${String(error && error.message || error)}`));
      socket.on('end', () => this.handleSocketClose('Event socket ended'));
      socket.on('close', () => this.handleSocketClose('Event socket closed'));
    } catch (error) {
      this.handleSocketClose(`Could not connect event socket: ${String(error && error.message || error)}`);
    }
  }

  private sendHandshake(target: URL) {
    const key = this.electronService.crypto.randomBytes(16).toString('base64');
    const authorization = this.connector.connector.headers && this.connector.connector.headers.Authorization;
    const lines = [
      'GET / HTTP/1.1',
      `Host: ${target.hostname}:${target.port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      authorization ? `Authorization: ${authorization}` : ''
    ].filter(line => line !== '');
    const request = `${lines.join('\r\n')}\r\n\r\n`;

    this.socket.write(request);
  }

  private receiveData(chunk: Buffer) {
    if (!this.handshakeComplete) {
      this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, chunk]);
      const marker = this.handshakeBuffer.indexOf('\r\n\r\n');
      if (marker < 0) return;

      const header = this.handshakeBuffer.slice(0, marker).toString('utf8');
      const remaining = this.handshakeBuffer.slice(marker + 4);
      if (header.indexOf('101') < 0) {
        this.handleSocketClose('LCU event socket handshake rejected');
        return;
      }

      this.handshakeComplete = true;
      this.patchState({connected: true, connecting: false, message: 'LCU events connected'});
      this.sendText(JSON.stringify([5, 'OnJsonApiEvent']));
      if (remaining.length) this.receiveFrames(remaining);
      return;
    }

    this.receiveFrames(chunk);
  }

  private receiveFrames(chunk: Buffer) {
    this.frameBuffer = Buffer.concat([this.frameBuffer, chunk]);

    while (this.frameBuffer.length >= 2) {
      const first = this.frameBuffer[0];
      const second = this.frameBuffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) === 0x80;
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.frameBuffer.length < offset + 2) return;
        length = this.frameBuffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.frameBuffer.length < offset + 8) return;
        const high = this.frameBuffer.readUInt32BE(offset);
        const low = this.frameBuffer.readUInt32BE(offset + 4);
        length = high * 4294967296 + low;
        offset += 8;
      }

      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.frameBuffer.length < offset + length) return;

      const mask = masked ? this.frameBuffer.slice(maskOffset, maskOffset + 4) : null;
      let payload = this.frameBuffer.slice(offset, offset + length);
      this.frameBuffer = this.frameBuffer.slice(offset + length);

      if (masked && mask) {
        payload = this.unmask(payload, mask);
      }

      if (opcode === 1) this.handleText(payload.toString('utf8'));
      if (opcode === 8) this.handleSocketClose('LCU event socket closed by server');
      if (opcode === 9) this.sendFrame(payload, 10);
    }
  }

  private handleText(text: string) {
    let message: any;
    try {
      message = JSON.parse(text);
    } catch (error) {
      return;
    }

    const event = Array.isArray(message) && message.length >= 3 ? message[2] as LcuJsonApiEvent : null;
    if (!event || !event.uri) return;

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

  private sendText(text: string) {
    this.sendFrame(Buffer.from(text, 'utf8'), 1);
  }

  private sendFrame(payload: Buffer, opcode: number) {
    if (!this.socket || this.socket.destroyed) return;

    const mask = this.electronService.crypto.randomBytes(4);
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(payload.length, 6);
    }

    this.socket.write(Buffer.concat([header, mask, this.unmask(payload, mask)]));
  }

  private unmask(payload: Buffer, mask: Buffer): Buffer {
    const output = Buffer.alloc(payload.length);
    for (let index = 0; index < payload.length; index++) {
      output[index] = payload[index] ^ mask[index % 4];
    }
    return output;
  }

  private handleSocketClose(message: string) {
    if (this.socket) {
      this.socket.removeAllListeners();
      if (!this.socket.destroyed) this.socket.destroy();
      this.socket = null;
    }
    this.patchState({connected: false, connecting: false, message});
    if (!this.manuallyClosed && this.connector.isReady()) this.scheduleReconnect();
  }

  private closeSocket(message: string) {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.handleSocketClose(message);
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private patchState(patch: Partial<LcuEventState>) {
    this.stateSubject.next({
      ...this.stateSubject.value,
      ...patch
    });
  }
}
