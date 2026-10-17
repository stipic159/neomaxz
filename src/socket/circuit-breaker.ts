export enum CircuitState {
  CLOSED = 'CLOSED',
  HALF_OPEN = 'HALF_OPEN',
  OPEN = 'OPEN',
}

export interface CircuitBreakerOptions {
  /** Maximum acceptable single RTT in ms before treating as latency failure (default 5000ms) */
  maxRttMs?: number;
  /** Multiplier of EWMA RTT to trigger latency failure (default 4x) */
  rttMultiplierThreshold?: number;
  /** Number of consecutive failures to trip the circuit open (default 2) */
  failureThreshold?: number;
  /** Time in ms before attempting HALF_OPEN probe (default 3000ms) */
  resetTimeoutMs?: number;
  /** Callback fired when circuit trips open */
  onTrip?: (error: Error) => void;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private ewmaRtt = 0;
  private consecutiveFailures = 0;
  private readonly maxRttMs: number;
  private readonly rttMultiplierThreshold: number;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly onTrip?: (error: Error) => void;
  private halfOpenTimer: NodeJS.Timeout | null = null;

  constructor(options: CircuitBreakerOptions = {}) {
    this.maxRttMs = options.maxRttMs ?? 5000;
    this.rttMultiplierThreshold = options.rttMultiplierThreshold ?? 4;
    this.failureThreshold = options.failureThreshold ?? 2;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 3000;
    this.onTrip = options.onTrip;
  }

  public getState(): CircuitState {
    return this.state;
  }

  public getMetrics(): { state: CircuitState; ewmaRtt: number; failures: number } {
    return {
      state: this.state,
      ewmaRtt: Math.round(this.ewmaRtt),
      failures: this.consecutiveFailures,
    };
  }

  /**
   * Records a successful round-trip response and updates EWMA.
   */
  public recordSuccess(rttMs: number): void {
    if (this.state === CircuitState.OPEN) return;

    // Check if RTT was excessively high
    if (this.isLatencyExcessive(rttMs)) {
      this.recordFailure(new Error(`RTT ${rttMs}ms exceeded acceptable latency threshold (EWMA: ${Math.round(this.ewmaRtt)}ms)`));
      return;
    }

    if (this.ewmaRtt === 0) {
      this.ewmaRtt = rttMs;
    } else {
      // Exponentially weighted moving average with alpha = 0.25
      const alpha = 0.25;
      this.ewmaRtt = alpha * rttMs + (1 - alpha) * this.ewmaRtt;
    }

    this.consecutiveFailures = 0;
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED;
    }
  }

  /**
   * Records a probe failure or timeout.
   */
  public recordFailure(error?: Error): void {
    this.consecutiveFailures++;

    if (this.state === CircuitState.HALF_OPEN || this.consecutiveFailures >= this.failureThreshold) {
      this.tripOpen(error ?? new Error('Circuit breaker tripped open due to consecutive failures'));
    }
  }

  /**
   * Checks whether an observed RTT is considered excessive.
   */
  public isLatencyExcessive(rttMs: number): boolean {
    if (rttMs > this.maxRttMs) return true;
    return this.ewmaRtt > 0 && rttMs > this.ewmaRtt * this.rttMultiplierThreshold && rttMs > 1500;

  }

  /**
   * Manually trips the circuit breaker to OPEN state.
   */
  public tripOpen(error: Error): void {
    if (this.state === CircuitState.OPEN) return;

    this.state = CircuitState.OPEN;

    if (this.halfOpenTimer) {
      clearTimeout(this.halfOpenTimer);
    }

    this.halfOpenTimer = setTimeout(() => {
      this.halfOpenTimer = null;
      if (this.state === CircuitState.OPEN) {
        this.state = CircuitState.HALF_OPEN;
      }
    }, this.resetTimeoutMs);
    this.halfOpenTimer.unref?.();

    if (this.onTrip) {
      try {
        this.onTrip(error);
      } catch {}
    }
  }

  /**
   * Resets the circuit breaker to healthy CLOSED state.
   */
  public reset(): void {
    if (this.halfOpenTimer) {
      clearTimeout(this.halfOpenTimer);
      this.halfOpenTimer = null;
    }
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
  }
}
