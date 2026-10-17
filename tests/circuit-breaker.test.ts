import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, CircuitState } from '../src/socket/circuit-breaker.js';

describe('CircuitBreaker', () => {
  test('starts in CLOSED state and updates EWMA RTT on success', () => {
    const cb = new CircuitBreaker();
    assert.equal(cb.getState(), CircuitState.CLOSED);

    cb.recordSuccess(100);
    assert.equal(cb.getMetrics().ewmaRtt, 100);

    cb.recordSuccess(200);
    // 0.25 * 200 + 0.75 * 100 = 125
    assert.equal(cb.getMetrics().ewmaRtt, 125);
    assert.equal(cb.getState(), CircuitState.CLOSED);
  });

  test('trips to OPEN state when consecutive failures reach threshold', () => {
    let trippedError: Error | undefined;
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      onTrip: (err) => {
        trippedError = err;
      },
    });

    cb.recordFailure(new Error('First fail'));
    assert.equal(cb.getState(), CircuitState.CLOSED);
    assert.equal(cb.getMetrics().failures, 1);
    assert.equal(trippedError, undefined);

    cb.recordFailure(new Error('Second fail'));
    assert.equal(cb.getState(), CircuitState.OPEN);
    assert.ok(trippedError);
    assert.match(trippedError!.message, /Second fail/);
  });

  test('excessive latency trips circuit', () => {
    let tripped = false;
    const cb = new CircuitBreaker({
      maxRttMs: 1000,
      failureThreshold: 1,
      onTrip: () => {
        tripped = true;
      },
    });

    cb.recordSuccess(100);
    // Latency 2000ms > maxRttMs 1000ms
    cb.recordSuccess(2000);

    assert.equal(cb.getState(), CircuitState.OPEN);
    assert.equal(tripped, true);
  });

  test('transitions from OPEN to HALF_OPEN after resetTimeout, then recovers on success', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 50,
    });

    cb.recordFailure(new Error('Down'));
    assert.equal(cb.getState(), CircuitState.OPEN);

    // Wait for resetTimeout
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(cb.getState(), CircuitState.HALF_OPEN);

    // Successful probe recovers to CLOSED
    cb.recordSuccess(80);
    assert.equal(cb.getState(), CircuitState.CLOSED);
    assert.equal(cb.getMetrics().failures, 0);
  });
});
