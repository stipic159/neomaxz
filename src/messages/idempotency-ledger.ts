import crypto from 'node:crypto';

export type OutboundStatus = 'PENDING' | 'ACKNOWLEDGED' | 'FAILED';

export interface LedgerEntry {
  cid: string;
  chatId: string;
  status: OutboundStatus;
  messageId?: string;
  error?: string;
  timestamp: number;
}

export class IdempotencyLedger {
  private entries = new Map<string, LedgerEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private counter = 0;

  constructor(options: { maxEntries?: number; ttlMs?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.ttlMs = options.ttlMs ?? 3600_000; // 1 hour
  }

  /**
   * Generates a collision-resistant monotonic client ID (timestamp_counter_random).
   */
  public generateCid(): string {
    const ts = Date.now();
    this.counter = (this.counter + 1) % 100000;
    const randomHex = crypto.randomBytes(4).toString('hex');
    return `${ts}_${this.counter}_${randomHex}`;
  }

  /**
   * Registers an outbound message before sending to server.
   */
  public registerOutbound(cid: string, chatId: string): void {
    if (this.entries.size >= this.maxEntries) {
      this.evictOldest();
    }

    this.entries.set(cid, {
      cid,
      chatId: String(chatId),
      status: 'PENDING',
      timestamp: Date.now(),
    });
  }

  /**
   * Marks message as acknowledged by server.
   */
  public markAcknowledged(cid: string, messageId?: string): void {
    const entry = this.entries.get(cid);
    if (entry) {
      entry.status = 'ACKNOWLEDGED';
      if (messageId) {
        entry.messageId = String(messageId);
      }
    } else {
      this.entries.set(cid, {
        cid,
        chatId: '',
        status: 'ACKNOWLEDGED',
        messageId: messageId ? String(messageId) : undefined,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Marks message as failed.
   */
  public markFailed(cid: string, error: string): void {
    const entry = this.entries.get(cid);
    if (entry) {
      entry.status = 'FAILED';
      entry.error = error;
    }
  }

  /**
   * Checks whether a message with this cid has already been acknowledged.
   */
  public isAcknowledged(cid: string): boolean {
    return this.entries.get(cid)?.status === 'ACKNOWLEDGED';
  }

  /**
   * Retrieves an entry by cid.
   */
  public get(cid: string): LedgerEntry | undefined {
    return this.entries.get(cid);
  }

  /**
   * Returns all pending (unacknowledged) entries.
   */
  public getPending(): LedgerEntry[] {
    const result: LedgerEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status === 'PENDING') {
        result.push({ ...entry });
      }
    }
    return result;
  }

  /**
   * Prunes entries older than ttlMs.
   */
  public prune(ttl = this.ttlMs): void {
    const now = Date.now();
    for (const [cid, entry] of this.entries.entries()) {
      if (now - entry.timestamp > ttl) {
        this.entries.delete(cid);
      }
    }
  }

  private evictOldest(): void {
    const firstKey = this.entries.keys().next().value;
    if (firstKey) {
      this.entries.delete(firstKey);
    }
  }
}
