/**
 * HTTP integration tests — drives the real Express app end-to-end:
 *   create pot  →  payment_success webhook  →  reconcile  →  live dashboard.
 *
 * Only the Nomba VA-provisioning call is mocked (it needs live credentials);
 * everything else is the real route + reconciliation + ledger path. Proves the
 * "webhook endpoint live" and "create-pot flow" milestones without secrets.
 */
process.env.DB_PATH = ':memory:'; // isolated per test-file (node runs files in child procs)

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Mock VA provisioning BEFORE requiring the server (server reads it at call time).
const nomba = require('../src/nomba');
let vaSeq = 0;
nomba.createVirtualAccount = async () => ({
  data: { bankAccountNumber: '80000000' + String(++vaSeq).padStart(2, '0') },
});

const app = require('../src/server');

let server, base;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
const get = (path) => fetch(base + path).then(async (r) => ({ status: r.status, body: await r.json() }));

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// Shared across tests (node runs same-file tests sequentially, in order).
let potId, adaId, adaNuban;

test('create-pot flow provisions a dedicated VA per member', async () => {
  const { status, body } = await post('/pots', {
    title: 'Detty December Owambe',
    target: 900000, // ₦9,000 in kobo
    members: [{ name: 'Ada' }, { name: 'Bola' }, { name: 'Chidi' }],
  });
  assert.equal(status, 201);
  assert.equal(body.members.length, 3);
  body.members.forEach((m) => assert.match(m.nuban, /^\d{10}$/, 'each member gets a NUBAN'));
  assert.equal(body.members[0].owed, 300000, 'equal split: ceil(900000/3)');

  potId = body.potId;
  adaId = body.members[0].memberId;
  adaNuban = body.members[0].nuban;
});

test('rejects an invalid pot (no members)', async () => {
  const { status } = await post('/pots', { title: 'x', target: 100 });
  assert.equal(status, 400);
});

test('payment_success webhook reconciles to the right member & pot', async () => {
  const ack = await post('/webhooks/nomba', {
    event_type: 'payment_success',
    data: { order: { orderReference: 'evt-1', orderId: 'uuid-1', amount: 3000, accountNumber: adaNuban } },
  });
  assert.equal(ack.status, 200);
  assert.deepEqual(ack.body, { received: true }, 'ACK-first per Nomba 60s gateway timeout');

  await delay(50); // handler ACKs, then reconciles inline
  const { body } = await get(`/pots/${potId}`);
  assert.equal(body.collected, 300000, '₦3,000 -> 300,000 kobo credited to pot');
  assert.equal(body.progress, 33);
  const ada = body.members.find((m) => m.id === adaId);
  assert.equal(ada.paid, 300000);
  assert.equal(ada.remaining, 0);
});

test('duplicate webhook does not double-count (idempotent over HTTP)', async () => {
  await post('/webhooks/nomba', {
    event_type: 'payment_success',
    data: { order: { orderReference: 'evt-1', orderId: 'uuid-1', amount: 3000, accountNumber: adaNuban } },
  });
  await delay(50);
  const { body } = await get(`/pots/${potId}`);
  assert.equal(body.collected, 300000, 'replay must not move the balance');
});

test('payment to an unknown NUBAN is quarantined, never added to the pot', async () => {
  await post('/webhooks/nomba', {
    event_type: 'payment_success',
    data: { order: { orderReference: 'evt-x', orderId: 'uuid-x', amount: 5000, accountNumber: '0000000000' } },
  });
  await delay(50);
  const { body } = await get(`/pots/${potId}`);
  assert.equal(body.collected, 300000, 'misdirected funds do not touch pot balance');
});

test('GET unknown pot returns 404', async () => {
  const { status } = await get('/pots/does-not-exist');
  assert.equal(status, 404);
});

test('health check responds', async () => {
  const { status, body } = await get('/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});
