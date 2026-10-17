import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RequestQueue, Priority } from '../src/socket/request-queue.js';

describe('RequestQueue & Rate Limiter', () => {
  test('dispatches high priority tasks before normal and low priority', async () => {
    const queue = new RequestQueue({ maxConcurrent: 1, maxGlobalPerSecond: 100 });
    const executed: string[] = [];

    // Occupy the queue with an initial task
    const blocker = queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 20));
      executed.push('BLOCKER');
    });

    // Enqueue in mixed order while busy
    const pLow = queue.enqueue(async () => { executed.push('LOW'); return 'low'; }, { priority: Priority.LOW });
    const pNormal = queue.enqueue(async () => { executed.push('NORMAL'); return 'normal'; }, { priority: Priority.NORMAL });
    const pHigh = queue.enqueue(async () => { executed.push('HIGH'); return 'high'; }, { priority: Priority.HIGH });

    await Promise.all([blocker, pLow, pNormal, pHigh]);

    assert.deepEqual(executed, ['BLOCKER', 'HIGH', 'NORMAL', 'LOW']);
  });

  test('rate limits per-chat bucket', async () => {
    // 2 tasks per second per chat
    const queue = new RequestQueue({ maxGlobalPerSecond: 100, maxChatPerSecond: 2 });
    const timestamps: number[] = [];

    const start = Date.now();
    const tasks = [1, 2, 3].map(() =>
      queue.enqueue(
        async () => {
          timestamps.push(Date.now() - start);
        },
        { bucketKey: 'chat:123' }
      )
    );

    await Promise.all(tasks);

    assert.equal(timestamps.length, 3);
    // First two tasks run immediately (capacity = 2)
    assert.ok(timestamps[0] < 50);
    assert.ok(timestamps[1] < 50);
    // Third task must wait for token refill (~500ms)
    assert.ok(timestamps[2] >= 400, `Expected 3rd task to wait >= 400ms, got ${timestamps[2]}ms`);
  });

  test('aborts queued task via AbortSignal', async () => {
    const queue = new RequestQueue({ maxGlobalPerSecond: 1 });
    const controller = new AbortController();

    // Consume token
    await queue.enqueue(async () => 'first');

    // Enqueue second task with abort controller
    const secondTask = queue.enqueue(async () => 'second', { signal: controller.signal });

    // Abort while queued
    controller.abort();

    await assert.rejects(secondTask, /Operation aborted/);
  });

  test('respects socket backpressure and drains', async () => {
    let buffered = 100000; // Over 64KB threshold
    let drainListener: (() => void) | undefined;

    const queue = new RequestQueue({
      maxBufferedBytes: 64000,
      getBufferedAmount: () => buffered,
      onDrain: (cb) => {
        drainListener = cb;
      },
    });

    let executed = false;
    const task = queue.enqueue(async () => {
      executed = true;
      return 'done';
    });

    // Wait a tick to verify task did not run due to backpressure
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(executed, false, 'Task should be paused due to backpressure');

    // Drain buffer
    buffered = 1000;
    drainListener?.();

    const res = await task;
    assert.equal(res, 'done');
    assert.equal(executed, true);
  });

  test('clear rejects all pending tasks with error', async () => {
    const queue = new RequestQueue({ maxGlobalPerSecond: 1 });

    // Block bucket
    await queue.enqueue(async () => 1);

    const pending1 = queue.enqueue(async () => 2);
    const pending2 = queue.enqueue(async () => 3);

    queue.clear(new Error('Connection lost'));

    await assert.rejects(pending1, /Connection lost/);
    await assert.rejects(pending2, /Connection lost/);
    assert.equal(queue.pendingCount, 0);
  });
});
