import { Command, OPCODES } from "../protocol/opcodes.js";
import type { InboundFrame, OutboundFrame } from "../protocol/frame.js";
import { RequestBroker } from "./request-broker.js";
import { MaxEventEmitter } from "./event-emitter.js";
import { WebSocketTransport, type ITransport, type TransportOptions } from "./transport.js";
import { DisconnectReason, type ConnectionStatus, type DisconnectInfo } from "../types/connection.js";
import { RequestQueue, Priority } from "./request-queue.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { GapRecoveryManager } from "./gap-recovery.js";

export interface SocketClientOptions {
  transport?: ITransport;
  transportOptions?: TransportOptions;
  timeoutMs?: number;
  keepAliveIntervalMs?: number;
  autoReconnect?: boolean;
  maxReconnectDelayMs?: number;
  maxGlobalPerSecond?: number;
  maxChatPerSecond?: number;
  messageNormalizer?: (payload: Record<string, any>) => any;
  onSessionHandshake?: (client: SocketClient) => Promise<void>;
  onReconnectSync?: (client: SocketClient) => Promise<void>;
}

export class SocketClient {
  public readonly ev = new MaxEventEmitter();
  public readonly queue: RequestQueue;
  public readonly circuitBreaker: CircuitBreaker;
  public readonly gapRecovery = new GapRecoveryManager();

  private readonly broker = new RequestBroker();
  private transport: ITransport;
  private readonly timeoutMs: number;
  private readonly keepAliveIntervalMs: number;
  private readonly autoReconnect: boolean;
  private readonly maxReconnectDelayMs: number;
  private messageNormalizer?: (payload: Record<string, any>) => any;
  private onSessionHandshake?: (client: SocketClient) => Promise<void>;
  private onReconnectSync?: (client: SocketClient) => Promise<void>;

  private status: ConnectionStatus = 'close';
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private closedByUser = false;

  constructor(options: SocketClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.keepAliveIntervalMs = options.keepAliveIntervalMs ?? 25000;
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 60000;
    this.messageNormalizer = options.messageNormalizer;
    this.onSessionHandshake = options.onSessionHandshake;
    this.onReconnectSync = options.onReconnectSync;

    this.transport = options.transport ?? new WebSocketTransport(options.transportOptions);

    const supportsBackpressure = typeof this.transport.bufferedAmount === 'number';

    this.queue = new RequestQueue({
      maxGlobalPerSecond: options.maxGlobalPerSecond ?? 30,
      maxChatPerSecond: options.maxChatPerSecond ?? 5,
      getBufferedAmount: supportsBackpressure ? () => this.transport.bufferedAmount ?? 0 : undefined,
      onDrain: supportsBackpressure
        ? (cb) => {
            try {
              this.transport.on('drain', cb);
            } catch {}
          }
        : undefined,
    });

    this.circuitBreaker = new CircuitBreaker({
      onTrip: (err) => {
        this.transport.close(err);
      },
    });

    this.setupTransportListeners();
  }

  public setSessionHandshake(handler?: (client: SocketClient) => Promise<void>): void {
    this.onSessionHandshake = handler;
  }

  public setReconnectSync(handler?: (client: SocketClient) => Promise<void>): void {
    this.onReconnectSync = handler;
  }

  public setMessageNormalizer(normalizer?: (payload: Record<string, any>) => any): void {
    this.messageNormalizer = normalizer;
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public isOpen(): boolean {
    return this.status === 'open' && this.transport.isOpen();
  }

  private setupTransportListeners(): void {
    this.transport.on('frame', (frame: InboundFrame) => {
      this.ev.emit('frame.inbound', frame);

      // Track last seen server time & sequence for gap recovery
      const frameTime = frame.payload?.time ?? frame.payload?.timestamp;
      this.gapRecovery.updateLastSeen(typeof frameTime === 'number' ? frameTime : undefined, frame.seq);

      // 1. If it's a response to one of our requests, resolve it
      if (frame.cmd === Command.RESPONSE || frame.cmd === Command.ERROR) {
        const handled = this.broker.handleResponse(frame);
        if (handled) return;
      }

      // 2. If it's a server push event
      if (frame.cmd === Command.EVENT) {
        this.handleServerPush(frame);
      }
    });

    this.transport.on('close', (error?: Error) => {
      this.handleDisconnect(error);
    });

    this.transport.on('error', (err: Error) => {
      this.ev.emit('error', err);
    });
  }

  /**
   * Connect to MAX server
   */
  public async connect(): Promise<void> {
    if (this.status === 'connecting' || this.isOpen()) return;

    this.closedByUser = false;
    this.clearTimers();
    this.setStatus('connecting');

    try {
      await this.transport.connect();

      // If a session handshake handler is configured (e.g. INIT + LOGIN), run it before declaring connection 'open'
      if (this.onSessionHandshake) {
        await this.onSessionHandshake(this);
      }

      // If this was a reconnection and a gap sync handler is configured, run sync
      if (this.reconnectAttempts > 0 && this.onReconnectSync) {
        try {
          await this.onReconnectSync(this);
        } catch (syncErr) {
          this.ev.emit('error', syncErr instanceof Error ? syncErr : new Error(String(syncErr)));
        }
      }

      this.setStatus('open');
      this.reconnectAttempts = 0;
      this.circuitBreaker.reset();
      this.startHeartbeat();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.handleDisconnect(error);
      throw error;
    }
  }

  /**
   * Sends a request frame through the rate-limited queue and awaits the matched response frame by seq.
   */
  public async query(options: {
    opcode: number;
    payload?: Record<string, any> | null;
    cmd?: Command | number;
    timeoutMs?: number;
    priority?: Priority;
    bucketKey?: string;
    signal?: AbortSignal;
  }): Promise<InboundFrame> {
    if (!this.transport.isOpen() || (this.status !== 'open' && this.status !== 'connecting')) {
      throw new Error('Cannot query: connection is not open');
    }

    const priority = options.priority ?? (options.opcode === OPCODES.PING ? Priority.HIGH : Priority.NORMAL);

    return this.queue.enqueue(
      async () => {
        if (!this.transport.isOpen() || (this.status !== 'open' && this.status !== 'connecting')) {
          throw new Error('Cannot query: connection is not open');
        }

        const seq = this.broker.nextSeq();
        const frame: OutboundFrame = {
          seq,
          opcode: options.opcode,
          cmd: options.cmd ?? Command.REQUEST,
          payload: options.payload,
        };

        this.ev.emit('frame.outbound', frame);
        const promise = this.broker.register(seq, options.opcode, options.timeoutMs ?? this.timeoutMs);

        try {
          await this.transport.send(frame);
        } catch (err) {
          // Rejection is isolated to this specific request only — do NOT rejectAll!
          const error = err instanceof Error ? err : new Error(String(err));
          this.broker.reject(seq, error);
          promise.catch(() => {});
          throw error;
        }

        return promise;
      },
      {
        priority,
        bucketKey: options.bucketKey,
        signal: options.signal,
      }
    );
  }

  /**
   * Disconnects the client deliberately
   */
  public disconnect(): void {
    this.closedByUser = true;
    this.clearTimers();
    this.queue.clear(new Error('Connection closed by user'));
    this.broker.rejectAll(new Error('Connection closed by user'));
    this.circuitBreaker.reset();
    this.transport.close();
    this.setStatus('close', { reason: DisconnectReason.connectionClosed, date: new Date() });
  }

  private handleDisconnect(error?: Error): void {
    this.clearTimers();
    const wasOpen = this.status === 'open';
    const reason = error ? DisconnectReason.connectionLost : DisconnectReason.connectionClosed;

    this.queue.clear(error ?? new Error('Connection closed'));
    this.broker.rejectAll(error ?? new Error('Connection closed'));
    this.circuitBreaker.reset();
    this.setStatus('close', { error, reason, date: new Date() });

    if (!this.closedByUser && this.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    // Exponential backoff with jitter: 1s, 2s, 4s, 8s, up to maxReconnectDelayMs
    const baseDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelayMs);
    const maxJitter = Math.min(1000, baseDelay);
    const jitter = Math.random() * maxJitter;
    const delay = Math.round(baseDelay + jitter);

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.closedByUser) return;
      try {
        await this.connect();
      } catch {
        // Will reschedule automatically in handleDisconnect
      }
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingTimer = setInterval(async () => {
      if (!this.isOpen()) return;

      const startTime = Date.now();
      try {
        await this.query({
          opcode: OPCODES.PING,
          timeoutMs: 5000,
          priority: Priority.HIGH,
        });
        const rtt = Date.now() - startTime;
        this.circuitBreaker.recordSuccess(rtt);
      } catch (err) {
        this.circuitBreaker.recordFailure(err instanceof Error ? err : new Error(String(err)));
      }
    }, this.keepAliveIntervalMs);
    this.pingTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus, disconnectPayload?: { error?: Error; reason?: DisconnectReason; date?: Date }): void {
    this.status = status;
    const lastDisconnect: DisconnectInfo | undefined = disconnectPayload
      ? {
          error: disconnectPayload.error,
          reason: disconnectPayload.reason,
          date: disconnectPayload.date ?? new Date(),
        }
      : undefined;

    this.ev.emit('connection.update', {
      connection: status,
      lastDisconnect,
    });
  }

  private handleServerPush(frame: InboundFrame): void {
    const payload = frame.payload;
    if (!payload) return;

    switch (frame.opcode) {
      case OPCODES.PUSH_MESSAGE: {
        const message = this.messageNormalizer
          ? this.messageNormalizer(payload)
          : (payload.message ?? payload);

        // Deduplication check
        if (message.id && this.gapRecovery.isDuplicate(String(message.id))) {
          break;
        }
        if (message.id) {
          this.gapRecovery.recordMessageId(String(message.id));
        }

        const msgTime = message.timestamp ?? payload.time ?? Date.now();
        this.gapRecovery.updateLastSeen(msgTime, frame.seq);

        this.ev.emit('messages.upsert', {
          messages: [message],
          type: 'notify',
        });
        break;
      }

      case OPCODES.PUSH_TYPING: {
        const rawAction = String(payload.action ?? (payload.typing === false ? 'PAUSED' : 'TYPING')).toLowerCase();
        let action: any = 'typing';
        if (rawAction.includes('record') || rawAction.includes('audio') || rawAction.includes('voice')) {
          action = 'recording_audio';
        } else if (rawAction.includes('upload') || rawAction.includes('file')) {
          action = 'uploading_file';
        } else if (rawAction.includes('pause') || payload.typing === false) {
          action = 'paused';
        }

        this.ev.emit('presence.update', {
          chatId: String(payload.chatId ?? ''),
          userId: String(payload.userId ?? ''),
          action,
          isTyping: action !== 'paused',
        });
        break;
      }

      case OPCODES.PUSH_READ: {
        if (payload.fileId || payload.photoToken || payload.videoId) {
          this.ev.emit('attachment.ready', {
            chatId: payload.chatId ? String(payload.chatId) : undefined,
            fileId: payload.fileId ? String(payload.fileId) : undefined,
            photoToken: payload.photoToken ? String(payload.photoToken) : undefined,
            videoId: payload.videoId ? String(payload.videoId) : undefined,
            url: payload.url,
            raw: payload,
          });
        }

        this.ev.emit('messages.read', {
          chatId: String(payload.chatId ?? ''),
          userId: String(payload.userId ?? ''),
          messageIds: Array.isArray(payload.messageIds) ? payload.messageIds.map(String) : undefined,
          markTime: Number(payload.markTime ?? Date.now()),
        });
        break;
      }

      default:
        // Other push events
        break;
    }
  }
}
