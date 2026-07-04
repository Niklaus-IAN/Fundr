/**
 * Webhook signature verification tests.
 *   - Unit: the signed string is built in the exact documented field order,
 *     and a correct HMAC verifies while a wrong / missing one does not.
 *   - HTTP: with enforcement on, forged / unsigned webhooks are rejected (401)
 *     and a correctly-signed one is accepted (200).
 */
process.env.DB_PATH = ':memory:';
process.env.NOMBA_WEBHOOK_SIGNING_KEY = 'NombaHackathon2026';
process.env.WEBHOOK_ENFORCE_SIGNATURE = 'true';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyNombaSignature, buildSignedString } = require('../src/webhook-signature');

const KEY = 'NombaHackathon2026';
const TS = '2023-03-31T05:56:47Z';

const samplePayload = {
  event_type: 'payment_success',
  requestId: 'req-1',
  data: {
    merchant: { userId: 'u1', walletId: 'w1' },
    transaction: {
      transactionId: 't1',
      type: 'vact_transfer',
      time: '2026-02-06T10:21:56Z',
      responseCode: '',
      transactionAmount: 120,
      aliasAccountNumber: '0000000000',
    },
  },
};

const sign = (payload, ts = TS) => {
  const s = buildSignedString(payload, (n) => (n.toLowerCase() === 'nomba-timestamp' ? ts : undefined));
  return crypto.createHmac('sha256', KEY).update(s).digest('base64');
};

test('buildSignedString uses the exact documented field order (colon-joined)', () => {
  const s = buildSignedString(samplePayload, () => TS);
  assert.equal(
    s,
    `payment_success:req-1:u1:w1:t1:vact_transfer:2026-02-06T10:21:56Z::${TS}`,
    'empty responseCode renders as an empty field (double colon before timestamp)'
  );
});

test('verifyNombaSignature: correct signature verifies', () => {
  const expected = sign(samplePayload);
  const headers = { 'nomba-signature': expected, 'nomba-timestamp': TS };
  const res = verifyNombaSignature({
    body: samplePayload,
    getHeader: (n) => headers[n.toLowerCase()],
    key: KEY,
  });
  assert.equal(res.ok, true);
});

test('verifyNombaSignature: tampered payload fails', () => {
  const expected = sign(samplePayload);
  const tampered = JSON.parse(JSON.stringify(samplePayload));
  tampered.data.transaction.transactionAmount = 999999; // attacker inflates amount
  const headers = { 'nomba-signature': expected, 'nomba-timestamp': TS };
  const res = verifyNombaSignature({
    body: tampered,
    getHeader: (n) => headers[n.toLowerCase()],
    key: KEY,
  });
  // transactionAmount is not a signed field, but transactionId is — flip it too.
  tampered.data.transaction.transactionId = 't-evil';
  const res2 = verifyNombaSignature({
    body: tampered,
    getHeader: (n) => headers[n.toLowerCase()],
    key: KEY,
  });
  assert.equal(res2.ok, false, 'changing a signed field must break verification');
  // (res is still ok because amount is not signed — documents the field set.)
  assert.equal(res.ok, true);
});

test('verifyNombaSignature: missing signature header fails', () => {
  const res = verifyNombaSignature({
    body: samplePayload,
    getHeader: (n) => (n.toLowerCase() === 'nomba-timestamp' ? TS : undefined),
    key: KEY,
  });
  assert.equal(res.ok, false);
});

/* ------------------------------------------------------- HTTP enforcement */

const app = require('../src/server');
let server, base;
const post = (path, body, headers = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }).then((r) => r.status);

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('HTTP: correctly-signed webhook is accepted (200)', async () => {
  const status = await post('/webhooks/nomba', samplePayload, {
    'nomba-signature': sign(samplePayload),
    'nomba-timestamp': TS,
  });
  assert.equal(status, 200);
});

test('HTTP: forged signature is rejected (401) when enforcing', async () => {
  const status = await post('/webhooks/nomba', samplePayload, {
    'nomba-signature': 'not-a-real-signature',
    'nomba-timestamp': TS,
  });
  assert.equal(status, 401);
});

test('HTTP: unsigned webhook is rejected (401) when enforcing', async () => {
  const status = await post('/webhooks/nomba', samplePayload, { 'nomba-timestamp': TS });
  assert.equal(status, 401);
});
