/**
 * Unit tests for the reconciliation engine — the three guarantees the
 * README and PRD stake the submission on:
 *   1. Idempotent replay        (no double-counting on duplicate webhooks)
 *   2. Over/underpayment class.  (excess / shortfall computed against owed)
 *   3. Quarantine               (payments to unmapped VAs never absorbed)
 *
 * Zero new dependencies — Node's built-in test runner + in-memory SQLite.
 * Run: npm test   (i.e. `node --test`)
 */
process.env.DB_PATH = ':memory:'; // isolate: never touch the dev dettypot.db

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { db, uid, potBalance } = require('../src/db');
const { reconcilePayment } = require('../src/reconcile');

/** Seed a pot + one active member + their dedicated VA. Returns ids + nuban. */
function seedMember({ owed, nuban, memberStatus = 'active' }) {
  const potId = uid();
  const memberId = uid();
  db.prepare('INSERT INTO pots (id, title, target) VALUES (?, ?, ?)').run(potId, 'Test Pot', owed);
  db.prepare(
    'INSERT INTO members (id, pot_id, name, owed, status) VALUES (?, ?, ?, ?, ?)'
  ).run(memberId, potId, 'Ada', owed, memberStatus);
  db.prepare(
    'INSERT INTO virtual_accounts (id, member_id, nuban, provider_ref) VALUES (?, ?, ?, ?)'
  ).run(uid(), memberId, nuban, memberId);
  return { potId, memberId, nuban };
}

test('exact payment: credited, classified exact, pot balance advances', () => {
  const { potId, nuban } = seedMember({ owed: 500000, nuban: '9990000001' });
  const res = reconcilePayment({
    orderReference: 'ord-exact-1',
    orderId: 'nomba-uuid-1',
    amount: 500000,
    receivingNuban: nuban,
  });
  assert.equal(res.status, 'credited');
  assert.equal(res.classification, 'exact');
  assert.equal(res.excess, 0);
  assert.equal(res.shortfall, 0);
  assert.equal(res.potBalance, 500000);
  assert.equal(potBalance(potId), 500000);
});

test('idempotent replay: duplicate orderReference never double-counts', () => {
  const { potId, nuban } = seedMember({ owed: 300000, nuban: '9990000002' });
  const first = reconcilePayment({
    orderReference: 'ord-dupe-1',
    orderId: 'nomba-uuid-2',
    amount: 300000,
    receivingNuban: nuban,
  });
  assert.equal(first.status, 'credited');
  assert.equal(potBalance(potId), 300000);

  // Same webhook lands again (Nomba retry / at-least-once delivery).
  const replay = reconcilePayment({
    orderReference: 'ord-dupe-1',
    orderId: 'nomba-uuid-2',
    amount: 300000,
    receivingNuban: nuban,
  });
  assert.equal(replay.status, 'duplicate');
  assert.equal(potBalance(potId), 300000, 'balance must not move on replay');

  // Ledger has exactly one entry for this pot.
  const rows = db.prepare('SELECT COUNT(*) AS n FROM ledger WHERE pot_id = ?').get(potId);
  assert.equal(rows.n, 1);
});

test('overpayment: excess computed against owed', () => {
  const { nuban } = seedMember({ owed: 200000, nuban: '9990000003' });
  const res = reconcilePayment({
    orderReference: 'ord-over-1',
    amount: 250000, // ₦500 over
    receivingNuban: nuban,
  });
  assert.equal(res.status, 'credited');
  assert.equal(res.classification, 'overpayment');
  assert.equal(res.excess, 50000);
  assert.equal(res.shortfall, 0);
});

test('underpayment: shortfall computed against owed', () => {
  const { nuban } = seedMember({ owed: 400000, nuban: '9990000004' });
  const res = reconcilePayment({
    orderReference: 'ord-under-1',
    amount: 150000, // ₦2,500 short
    receivingNuban: nuban,
  });
  assert.equal(res.status, 'credited');
  assert.equal(res.classification, 'underpayment');
  assert.equal(res.shortfall, 250000);
  assert.equal(res.excess, 0);
});

test('quarantine: payment to an unmapped VA is flagged, not absorbed', () => {
  const res = reconcilePayment({
    orderReference: 'ord-quar-1',
    amount: 100000,
    receivingNuban: '0000000000', // no VA maps to this
  });
  assert.equal(res.status, 'quarantined');

  const q = db
    .prepare('SELECT * FROM quarantine WHERE order_reference = ?')
    .get('ord-quar-1');
  assert.ok(q, 'a quarantine row must exist');
  assert.equal(q.amount, 100000);

  // No ledger entry was created for this misdirected payment.
  const led = db
    .prepare('SELECT COUNT(*) AS n FROM ledger WHERE ref = ?')
    .get('ord-quar-1');
  assert.equal(led.n, 0);
});

test('quarantine: payment to a dropped member is not credited', () => {
  const { nuban } = seedMember({
    owed: 500000,
    nuban: '9990000005',
    memberStatus: 'dropped',
  });
  const res = reconcilePayment({
    orderReference: 'ord-quar-2',
    amount: 500000,
    receivingNuban: nuban,
  });
  assert.equal(res.status, 'quarantined');
});
