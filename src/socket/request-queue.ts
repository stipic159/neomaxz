export enum Priority {
  HIGH = 0,
  NORMAL = 1,
  LOW = 2,
}

export interface TokenBucketConfig {
  capacity: number; // Max burst tokens
  fillPerSecond: number; // Tokens added per second
}

export interface RequestQueueOptions {
  priority?: Priority;
  bucketKey?: string;
  signal?: AbortSignal;
}

export interface QueueConfig {
  maxGlobalPerSecond?: number;
  maxChatPerSecond?: number;
  maxConcurrent?: number;
  maxBufferedBytes?: number;
  getBufferedAmount?: () => number;
  onDrain?: (listener: () => void) => void;
}

interface QueuedItem<T = any> {
  id: number;
  task: () => Promise<T>;
  priority: Priority;
  bucketKey?: string;
  signal?: AbortSignal;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  enqueuedAt: number;
}

class TokenBucket {
  public tokens: number;
  public lastUpdate: number;
  public readonly capacity: number;
  public readonly fillPerSecond: number;

  constructor(config: TokenBucketConfig) {
    this.capacity = config.capacity;
    this.fillPerSecond = config.fillPerSecond;
    this.tokens = config.capacity;
    this.lastUpdate = Date.now();
  }

  public refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastUpdate) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.fillPerSecond);
    this.lastUpdate = now;
  }

  public tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  public getWaitTimeMs(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    const needed = 1 - this.tokens;
    return Math.ceil((needed / this.fillPerSecond) * 1000);
  }
}

export class RequestQueue {
  private queue: QueuedItem[] = [];
  private nextItemId = 1;
  private isProcessing = false;
  private isDraining = false;
  private processTimer: NodeJS.Timeout | null = null;
  private activeCount = 0;

  private globalBucket: TokenBucket;
  private chatBuckets = new Map<string, TokenBucket>();
  private readonly maxChatPerSecond: number;
  private readonly maxConcurrent: number;
  private readonly maxBufferedBytes: number;
  private readonly getBufferedAmount?: () => number;

  constructor(config: QueueConfig = {}) {
    const globalRate = config.maxGlobalPerSecond ?? 30;
    this.maxChatPerSecond = config.maxChatPerSecond ?? 5;
    this.maxConcurrent = config.maxConcurrent ?? 10;
    this.maxBufferedBytes = config.maxBufferedBytes ?? 64 * 1024; // 64 KB
    this.getBufferedAmount = config.getBufferedAmount;

    this.globalBucket = new TokenBucket({
      capacity: globalRate,
      fillPerSecond: globalRate,
    });

    if (config.onDrain) {
      config.onDrain(() => {
        this.isDraining = false;
        this.scheduleProcess(0);
      });
    }
  }

  public get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * Enqueues a task with priority, rate-limiting bucket key, and optional cancellation signal.
   */
  public enqueue<T>(task: () => Promise<T>, options: RequestQueueOptions = {}): Promise<T> {
    const priority = options.priority ?? Priority.NORMAL;

    if (options.signal?.aborted) {
      return Promise.reject(new Error('Operation aborted before enqueueing'));
    }

    return new Promise<T>((resolve, reject) => {
      const item: QueuedItem<T> = {
        id: this.nextItemId++,
        task,
        priority,
        bucketKey: options.bucketKey,
        signal: options.signal,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };

      if (options.signal) {
        const onAbort = () => {
          options.signal?.removeEventListener('abort', onAbort);
          const idx = this.queue.findIndex((q) => q.id === item.id);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            reject(new Error('Operation aborted'));
          }
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      // Priority insertion: HIGH (0) first, then NORMAL (1), then LOW (2)
      let insertIndex = this.queue.length;
      for (let i = 0; i < this.queue.length; i++) {
        if (item.priority < this.queue[i].priority) {
          insertIndex = i;
          break;
        }
      }
      this.queue.splice(insertIndex, 0, item);

      if (!this.isProcessing && !this.isDraining && !this.processTimer) {
        this.processQueue().catch(() => {});
      } else {
        this.scheduleProcess(0);
      }
    });
  }

  /**
   * Clears all pending requests, rejecting them with the given error.
   */
  public clear(error = new Error('Queue cleared')): void {
    if (this.processTimer) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }
    const items = this.queue.splice(0, this.queue.length);
    for (const item of items) {
      item.reject(error);
    }
  }

  private scheduleProcess(delayMs: number): void {
    if (this.processTimer) return;
    this.processTimer = setTimeout(() => {
      this.processTimer = null;
      this.processQueue().catch(() => {});
    }, Math.max(0, delayMs));
    this.processTimer.unref?.();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
        // 1. Check backpressure on socket buffer
        if (this.getBufferedAmount) {
          const buffered = this.getBufferedAmount();
          if (buffered >= this.maxBufferedBytes) {
            this.isDraining = true;
            break; // Wait for onDrain event
          }
        }

        // 2. Find first item whose rate limits are satisfied
        let selectedIndex = -1;
        let minWaitTime = Infinity;

        for (let i = 0; i < this.queue.length; i++) {
          const item = this.queue[i];

          // High priority items bypass rate limits (e.g. PING / ACK)
          if (item.priority === Priority.HIGH) {
            selectedIndex = i;
            break;
          }

          // Check global bucket
          const globalWait = this.globalBucket.getWaitTimeMs();
          if (globalWait > 0) {
            minWaitTime = Math.min(minWaitTime, globalWait);
            continue;
          }

          // Check per-chat bucket if specified
          if (item.bucketKey) {
            let chatBucket = this.chatBuckets.get(item.bucketKey);
            if (!chatBucket) {
              chatBucket = new TokenBucket({
                capacity: this.maxChatPerSecond,
                fillPerSecond: this.maxChatPerSecond,
              });
              this.chatBuckets.set(item.bucketKey, chatBucket);
            }

            const chatWait = chatBucket.getWaitTimeMs();
            if (chatWait > 0) {
              minWaitTime = Math.min(minWaitTime, chatWait);
              continue;
            }
          }

          selectedIndex = i;
          break;
        }

        if (selectedIndex === -1) {
          // No item is ready now, schedule next check after minWaitTime
          if (minWaitTime < Infinity && minWaitTime > 0) {
            this.scheduleProcess(minWaitTime);
          }
          break;
        }

        const [item] = this.queue.splice(selectedIndex, 1);

        // Consume tokens if not HIGH priority
        if (item.priority !== Priority.HIGH) {
          this.globalBucket.tryConsume();
          if (item.bucketKey) {
            const chatBucket = this.chatBuckets.get(item.bucketKey);
            chatBucket?.tryConsume();
          }
        }

        this.activeCount++;
        item.task()
          .then((res) => item.resolve(res))
          .catch((err) => item.reject(err))
          .finally(() => {
            this.activeCount--;
            this.scheduleProcess(0);
          });
      }
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0 && !this.isDraining && !this.processTimer) {
        this.scheduleProcess(10);
      }
    }
  }
}
