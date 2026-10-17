export interface GapRecoveryOptions {
  /** Maximum time window to sync missed messages upon reconnect (default 24 hours) */
  maxGapWindowMs?: number;
  /** Maximum number of recent message IDs to track for deduplication (default 2000) */
  dedupCacheSize?: number;
}

export class GapRecoveryManager {
  private lastServerTime = 0;
  private lastSeq = 0;
  private recentMessageIds = new Set<string>();
  private recentIdQueue: string[] = [];
  private readonly maxGapWindowMs: number;
  private readonly dedupCacheSize: number;
  private isSyncing = false;

  constructor(options: GapRecoveryOptions = {}) {
    this.maxGapWindowMs = options.maxGapWindowMs ?? 24 * 60 * 60 * 1000;
    this.dedupCacheSize = options.dedupCacheSize ?? 2000;
  }

  /**
   * Updates last seen timestamp and sequence number from any received frame or push.
   */
  public updateLastSeen(timestamp?: number, seq?: number): void {
    if (typeof timestamp === 'number' && timestamp > 0 && timestamp > this.lastServerTime) {
      this.lastServerTime = timestamp;
    }
    if (typeof seq === 'number' && seq > 0 && seq > this.lastSeq) {
      this.lastSeq = seq;
    }
  }

  public getLastServerTime(): number {
    return this.lastServerTime;
  }

  public getLastSeq(): number {
    return this.lastSeq;
  }

  /**
   * Records a seen message ID in the deduplication cache.
   */
  public recordMessageId(messageId: string): void {
    if (!messageId || this.recentMessageIds.has(messageId)) return;
    this.recentMessageIds.add(messageId);
    this.recentIdQueue.push(messageId);

    if (this.recentIdQueue.length > this.dedupCacheSize) {
      const oldest = this.recentIdQueue.shift();
      if (oldest) {
        this.recentMessageIds.delete(oldest);
      }
    }
  }

  /**
   * Checks if a message ID has already been processed.
   */
  public isDuplicate(messageId: string): boolean {
    return this.recentMessageIds.has(messageId);
  }

  /**
   * Performs gap recovery upon reconnect: queries history delta, deduplicates, and passes new messages.
   */
  public async performSync<T extends { id?: string | number | bigint; time?: number }>(
    fetchHistoryDelta: (fromTimestamp: number) => Promise<T[]>,
    onMissingMessages: (messages: T[]) => Promise<void> | void
  ): Promise<{ syncedCount: number; fromTimestamp: number }> {
    if (this.isSyncing || this.lastServerTime === 0) {
      return { syncedCount: 0, fromTimestamp: this.lastServerTime };
    }

    this.isSyncing = true;
    try {
      // Allow 5 second clock skew overlap
      const fromTimestamp = Math.max(this.lastServerTime - 5000, Date.now() - this.maxGapWindowMs);
      const fetchedMessages = await fetchHistoryDelta(fromTimestamp);

      const newMessages: T[] = [];
      for (const msg of fetchedMessages) {
        const id = String(msg.id ?? '');
        if (id && !this.isDuplicate(id)) {
          this.recordMessageId(id);
          newMessages.push(msg);
        }
      }

      if (newMessages.length > 0) {
        await onMissingMessages(newMessages);
      }

      this.updateLastSeen(Date.now());
      return { syncedCount: newMessages.length, fromTimestamp };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Resets the gap recovery state.
   */
  public reset(): void {
    this.lastServerTime = 0;
    this.lastSeq = 0;
    this.recentMessageIds.clear();
    this.recentIdQueue = [];
    this.isSyncing = false;
  }
}
