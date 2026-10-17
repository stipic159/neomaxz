import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { IdempotencyLedger } from '../src/messages/idempotency-ledger.js';

describe('IdempotencyLedger', () => {
  test('generates unique monotonic client IDs', () => {
    const ledger = new IdempotencyLedger();
    const cid1 = ledger.generateCid();
    const cid2 = ledger.generateCid();

    assert.notEqual(cid1, cid2);
    assert.match(cid1, /^\d+_\d+_[0-9a-f]{8}$/);
  });

  test('tracks pending and acknowledged status correctly', () => {
    const ledger = new IdempotencyLedger();
    const cid = ledger.generateCid();

    ledger.registerOutbound(cid, 'chat_999');
    assert.equal(ledger.isAcknowledged(cid), false);
    assert.equal(ledger.getPending().length, 1);
    assert.equal(ledger.getPending()[0].cid, cid);

    ledger.markAcknowledged(cid, 'msg_12345');
    assert.equal(ledger.isAcknowledged(cid), true);
    assert.equal(ledger.getPending().length, 0);
    assert.equal(ledger.get(cid)?.messageId, 'msg_12345');
  });

  test('evicts oldest entry when maxEntries reached', () => {
    const ledger = new IdempotencyLedger({ maxEntries: 2 });
    ledger.registerOutbound('cid_1', 'chat_1');
    ledger.registerOutbound('cid_2', 'chat_1');
    ledger.registerOutbound('cid_3', 'chat_1'); // Should evict cid_1

    assert.equal(ledger.get('cid_1'), undefined);
    assert.ok(ledger.get('cid_2'));
    assert.ok(ledger.get('cid_3'));
  });

  test('prunes entries older than TTL', () => {
    const ledger = new IdempotencyLedger({ ttlMs: 100 });
    ledger.registerOutbound('old_cid', 'chat_1');
    ledger.get('old_cid')!.timestamp = Date.now() - 500;

    ledger.registerOutbound('new_cid', 'chat_1');

    ledger.prune();
    assert.equal(ledger.get('old_cid'), undefined);
    assert.ok(ledger.get('new_cid'));
  });
});
