import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GapRecoveryManager } from '../src/socket/gap-recovery.js';

describe('GapRecoveryManager', () => {
  test('tracks last seen timestamp and sequence monotonically', () => {
    const mgr = new GapRecoveryManager();
    assert.equal(mgr.getLastServerTime(), 0);

    mgr.updateLastSeen(1000, 5);
    assert.equal(mgr.getLastServerTime(), 1000);
    assert.equal(mgr.getLastSeq(), 5);

    // Stale lower values do not overwrite
    mgr.updateLastSeen(900, 4);
    assert.equal(mgr.getLastServerTime(), 1000);
    assert.equal(mgr.getLastSeq(), 5);

    mgr.updateLastSeen(1200, 7);
    assert.equal(mgr.getLastServerTime(), 1200);
    assert.equal(mgr.getLastSeq(), 7);
  });

  test('deduplicates messages and discards seen IDs', () => {
    const mgr = new GapRecoveryManager({ dedupCacheSize: 3 });
    mgr.recordMessageId('msg_1');
    mgr.recordMessageId('msg_2');

    assert.equal(mgr.isDuplicate('msg_1'), true);
    assert.equal(mgr.isDuplicate('msg_2'), true);
    assert.equal(mgr.isDuplicate('msg_3'), false);

    // Exceed cache size (3)
    mgr.recordMessageId('msg_3');
    mgr.recordMessageId('msg_4'); // Should evict msg_1

    assert.equal(mgr.isDuplicate('msg_1'), false);
    assert.equal(mgr.isDuplicate('msg_4'), true);
  });

  test('performs sync, deduplicating against known messages', async () => {
    const mgr = new GapRecoveryManager();
    const recentTime = Date.now() - 60_000;
    mgr.updateLastSeen(recentTime);
    mgr.recordMessageId('msg_old');

    const serverDelta = [
      { id: 'msg_old', text: 'Already seen' },
      { id: 'msg_new_1', text: 'New message 1' },
      { id: 'msg_new_2', text: 'New message 2' },
    ];

    const emitted: any[] = [];
    const result = await mgr.performSync(
      async (fromTs) => {
        assert.ok(fromTs <= recentTime);
        return serverDelta;
      },
      (newMsgs) => {
        emitted.push(...newMsgs);
      }
    );

    assert.equal(result.syncedCount, 2);
    assert.equal(emitted.length, 2);
    assert.equal(emitted[0].id, 'msg_new_1');
    assert.equal(emitted[1].id, 'msg_new_2');

    // Subsequent call should have nothing new
    const secondResult = await mgr.performSync(async () => serverDelta, () => {});
    assert.equal(secondResult.syncedCount, 0);
  });
});
