import type { MaxEvents, EventKey, EventListener } from "../types/events.js";

interface QueuedEvent<K extends EventKey = EventKey> {
  event: K;
  data: MaxEvents[K];
}

export class MaxEventEmitter {
  private listeners: Map<EventKey, Set<EventListener<any>>> = new Map();
  private queue: QueuedEvent[] = [];
  private isPaused = false;

  public on<K extends EventKey>(event: K, listener: EventListener<K>): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return this;
  }

  public once<K extends EventKey>(event: K, listener: EventListener<K>): this {
    const wrapped: EventListener<K> = async (data) => {
      this.off(event, wrapped);
      await listener(data);
    };
    return this.on(event, wrapped);
  }

  public off<K extends EventKey>(event: K, listener: EventListener<K>): this {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
    return this;
  }

  public removeAllListeners(event?: EventKey): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  /**
   * Enqueues an event and starts processing the queue asynchronously.
   * Guarantees that events are delivered in order, even when handlers are asynchronous.
   */
  public emit<K extends EventKey>(event: K, data: MaxEvents[K]): void {
    this.queue.push({ event, data });
    void this.drain();
  }

  /**
   * Pauses dispatching (events accumulate in the queue).
   * Useful during initial handshake or historical replay.
   */
  public pause(): void {
    this.isPaused = true;
  }

  /**
   * Resumes dispatching and drains queued events.
   */
  public resume(): void {
    this.isPaused = false;
    void this.drain();
  }

  private drain(): void {
    if (this.isPaused) return;

    while (this.queue.length > 0 && !this.isPaused) {
      const item = this.queue.shift();
      if (!item) break;

      const set = this.listeners.get(item.event);
      if (set && set.size > 0) {
        const listeners = Array.from(set);
        for (const listener of listeners) {
          void this.invokeListener(item.event, listener, item.data);
        }
      }
    }
  }

  private async invokeListener(event: EventKey, listener: EventListener<any>, data: any): Promise<void> {
    try {
      await listener(data);
    } catch (err: any) {
      // NEVER swallow assertion errors — immediately bubble up to fail tests
      if (
        err &&
        (err.name === 'AssertionError' ||
          err.constructor?.name === 'AssertionError' ||
          err.code === 'ERR_ASSERTION')
      ) {
        queueMicrotask(() => {
          throw err;
        });
        return;
      }

      if (event !== 'error') {
        if (this.listeners.has('error') && (this.listeners.get('error')?.size ?? 0) > 0) {
          this.emit('error', err instanceof Error ? err : new Error(String(err)));
        } else {
          console.error(`Unhandled error in '${String(event)}' listener:`, err);
        }
      } else {
        console.error('Unhandled error in MaxEventEmitter:', err);
      }
    }
  }
}
