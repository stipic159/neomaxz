import tls from 'node:tls';
import { WebSocket } from 'ws';
import { getTlsCaCertificates } from '../protocol/ca.js';
import { decodeFrame, encodeFrame, StreamFrameBuffer, type InboundFrame, type OutboundFrame } from '../protocol/frame.js';
import { DEFAULT_ORIGIN, DEFAULT_RAW_TCP_HOST, DEFAULT_RAW_TCP_PORT, DEFAULT_WEBSOCKET_URL } from '../protocol/opcodes.js';

export interface TransportOptions {
  url?: string;
  host?: string;
  port?: number;
  origin?: string;
  handshakeTimeoutMs?: number;
  ca?: string[];
}

export interface ITransport {
  connect(): Promise<void>;
  send(frame: OutboundFrame): Promise<void>;
  close(error?: Error): void;
  on(event: 'frame', listener: (frame: InboundFrame) => void): this;
  on(event: 'close', listener: (error?: Error) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  isOpen(): boolean;
}

/**
 * WebSocket Transport (standard for web.max.ru).
 * Connects to wss://api.oneme.ru/websocket with Russian CA chain and Origin header.
 */
export class WebSocketTransport implements ITransport {
  private ws: WebSocket | null = null;
  private options: Required<TransportOptions>;
  private listeners = {
    frame: new Set<(frame: InboundFrame) => void>(),
    close: new Set<(error?: Error) => void>(),
    error: new Set<(error: Error) => void>(),
  };

  constructor(options: TransportOptions = {}) {
    this.options = {
      url: options.url ?? DEFAULT_WEBSOCKET_URL,
      host: options.host ?? DEFAULT_RAW_TCP_HOST,
      port: options.port ?? DEFAULT_RAW_TCP_PORT,
      origin: options.origin ?? DEFAULT_ORIGIN,
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 15000,
      ca: options.ca ?? getTlsCaCertificates(),
    };
  }

  public on(event: 'frame', listener: (frame: InboundFrame) => void): this;
  public on(event: 'close', listener: (error?: Error) => void): this;
  public on(event: 'error', listener: (error: Error) => void): this;
  public on(event: 'frame' | 'close' | 'error', listener: any): this {
    this.listeners[event].add(listener);
    return this;
  }

  public isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public async connect(): Promise<void> {
    if (this.isOpen()) return;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.options.url, {
        ca: this.options.ca,
        headers: { Origin: this.options.origin },
        handshakeTimeout: this.options.handshakeTimeoutMs,
      });

      this.ws = ws;

      const onOpen = () => {
        cleanup();
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        ws.off('open', onOpen);
        ws.off('error', onError);
      };

      ws.once('open', onOpen);
      ws.once('error', onError);

      ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
          const frame = decodeFrame(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
          for (const listener of this.listeners.frame) {
            listener(frame);
          }
        } catch (err) {
          this.emitError(err instanceof Error ? err : new Error(String(err)));
        }
      });

      ws.on('close', (code, reason) => {
        const error = code !== 1000 ? new Error(`WebSocket closed with code ${code}: ${reason.toString()}`) : undefined;
        this.ws = null;
        for (const listener of this.listeners.close) {
          listener(error);
        }
      });

      ws.on('error', (err) => {
        this.emitError(err);
      });
    });
  }

  public async send(frame: OutboundFrame): Promise<void> {
    if (!this.isOpen()) {
      throw new Error('Cannot send frame: WebSocket is not open');
    }

    const bytes = encodeFrame(frame);
    return new Promise<void>((resolve, reject) => {
      this.ws!.send(bytes, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public close(error?: Error): void {
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private emitError(err: Error): void {
    for (const listener of this.listeners.error) {
      listener(err);
    }
  }
}

/**
 * Raw TLS Transport (mobile / desktop client style).
 * Connects directly to api2.oneme.ru:443 without WebSocket framing.
 */
export class TlsSocketTransport implements ITransport {
  private socket: tls.TLSSocket | null = null;
  private streamBuffer = new StreamFrameBuffer();
  private options: Required<TransportOptions>;
  private listeners = {
    frame: new Set<(frame: InboundFrame) => void>(),
    close: new Set<(error?: Error) => void>(),
    error: new Set<(error: Error) => void>(),
  };

  constructor(options: TransportOptions = {}) {
    this.options = {
      url: options.url ?? DEFAULT_WEBSOCKET_URL,
      host: options.host ?? DEFAULT_RAW_TCP_HOST,
      port: options.port ?? DEFAULT_RAW_TCP_PORT,
      origin: options.origin ?? DEFAULT_ORIGIN,
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 15000,
      ca: options.ca ?? getTlsCaCertificates(),
    };
  }

  public on(event: 'frame', listener: (frame: InboundFrame) => void): this;
  public on(event: 'close', listener: (error?: Error) => void): this;
  public on(event: 'error', listener: (error: Error) => void): this;
  public on(event: 'frame' | 'close' | 'error', listener: any): this {
    this.listeners[event].add(listener);
    return this;
  }

  public isOpen(): boolean {
    return this.socket !== null && !this.socket.destroyed && this.socket.writable;
  }

  public async connect(): Promise<void> {
    if (this.isOpen()) return;
    this.streamBuffer.clear();

    return new Promise<void>((resolve, reject) => {
      const socket = tls.connect(
        {
          host: this.options.host,
          port: this.options.port,
          servername: this.options.host,
          ca: this.options.ca,
          timeout: this.options.handshakeTimeoutMs,
        },
        () => {
          this.socket = socket;
          resolve();
        }
      );

      let lastSocketError: Error | undefined;

      socket.once('error', (err) => {
        lastSocketError = err;
        reject(err);
      });

      socket.on('data', (chunk: Buffer) => {
        try {
          this.streamBuffer.append(chunk);
          let frame: InboundFrame | null;
          while ((frame = this.streamBuffer.nextFrame()) !== null) {
            for (const listener of this.listeners.frame) {
              try {
                listener(frame);
              } catch (listenerErr) {
                const err = listenerErr instanceof Error ? listenerErr : new Error(String(listenerErr));
                this.emitError(err);
              }
            }
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.emitError(error);
        }
      });

      socket.on('close', (hadError) => {
        const error = hadError
          ? (lastSocketError ?? new Error('TLS socket closed with transmission error'))
          : undefined;
        this.socket = null;
        for (const listener of this.listeners.close) {
          listener(error);
        }
      });

      socket.on('error', (err) => {
        lastSocketError = err;
        for (const listener of this.listeners.error) {
          listener(err);
        }
      });
    });
  }

  private emitError(err: Error): void {
    for (const listener of this.listeners.error) {
      listener(err);
    }
  }

  public async send(frame: OutboundFrame): Promise<void> {
    if (!this.isOpen()) {
      throw new Error('Cannot send frame: TLS socket is not open');
    }

    const bytes = encodeFrame(frame);
    return new Promise<void>((resolve, reject) => {
      this.socket!.write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public close(error?: Error): void {
    if (this.socket) {
      this.socket.destroy(error);
      this.socket = null;
    }
  }
}
