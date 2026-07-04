require('dotenv').config({ quiet: true });
const express = require('express');
const { db, uid, potBalance } = require('./db');
const { reconcilePayment } = require('./reconcile');
const { verifyNombaSignature } = require('./webhook-signature');
const nomba = require('./nomba');

const app = express();
app.use(express.json());

// Shared hackathon signing key. When set, we verify the nomba-signature header.
const WEBHOOK_KEY = process.env.NOMBA_WEBHOOK_SIGNING_KEY || '';
// Reject unverified webhooks only when explicitly enforcing. Default is
// log-and-continue so a first-run field mismatch is diagnosable without
// silently dropping a real payment — flip to true once signatures confirm.
const ENFORCE_SIG = process.env.WEBHOOK_ENFORCE_SIGNATURE === 'true';

/* ---------------------------------------------------------------- pots */

/**
 * Create a pot + members, and provision one dedicated Nomba VA per member.
 */
app.post('/pots', async (req, res) => {
  const { title, target, deadline, splitMode = 'equal', members = [] } = req.body;
  if (!title || !target || members.length === 0) {
    return res.status(400).json({ error: 'title, target and members are required' });
  }
  if (splitMode === 'custom') {
    const sum = members.reduce((s, m) => s + (m.owed || 0), 0);
    if (sum !== target) return res.status(400).json({ error: 'custom amounts must sum to target' });
  }

  const potId = uid();
  const equalShare = Math.ceil(target / members.length);
  db.prepare(
    'INSERT INTO pots (id, title, target, deadline, split_mode) VALUES (?, ?, ?, ?, ?)'
  ).run(potId, title, target, deadline ?? null, splitMode);

  const created = [];
  for (const m of members) {
    const memberId = uid();
    const owed = splitMode === 'equal' ? equalShare : m.owed;
    db.prepare(
      'INSERT INTO members (id, pot_id, name, phone, owed) VALUES (?, ?, ?, ?, ?)'
    ).run(memberId, potId, m.name, m.phone ?? null, owed);

    // Provision dedicated VA (accountRef = memberId keeps it idempotent).
    let nuban = null;
    try {
      const va = await nomba.createVirtualAccount({
        accountRef: memberId,
        accountName: `DettyPot/${m.name}`,
        expectedAmount: req.body.strictMode ? owed : undefined,
      });
      nuban = va?.data?.bankAccountNumber ?? null;
      db.prepare(
        'INSERT INTO virtual_accounts (id, member_id, nuban, provider_ref, expected_amount) VALUES (?, ?, ?, ?, ?)'
      ).run(uid(), memberId, nuban, memberId, req.body.strictMode ? owed : null);
    } catch (err) {
      console.error(`VA provisioning failed for ${m.name}:`, err.message);
      // Sandbox VA cap (~2) may bite here — see PRD §6.4. Member is created;
      // VA can be retried once the cap is lifted.
    }
    created.push({ memberId, name: m.name, owed, nuban });
  }

  res.status(201).json({ potId, title, target, members: created });
});

/** Live pot dashboard data. */
app.get('/pots/:id', (req, res) => {
  const pot = db.prepare('SELECT * FROM pots WHERE id = ?').get(req.params.id);
  if (!pot) return res.status(404).json({ error: 'not found' });
  const members = db
    .prepare(
      `SELECT m.id, m.name, m.owed, m.paid, m.refunded, m.status, va.nuban
       FROM members m LEFT JOIN virtual_accounts va ON va.member_id = m.id
       WHERE m.pot_id = ?`
    )
    .all(pot.id);
  const collected = potBalance(pot.id);
  res.json({
    ...pot,
    collected,
    progress: Math.min(100, Math.round((collected / pot.target) * 100)),
    members: members.map((m) => ({ ...m, remaining: Math.max(0, m.owed - m.paid) })),
  });
});

/* ------------------------------------------------------------ webhooks */

/**
 * Nomba webhook receiver.
 * ACK immediately (gateway timeout is 60s) and process inline for now;
 * move to a queue if handlers grow. Signature verification: TODO — Nomba
 * signs specific payload fields, not the raw body; confirm fields against
 * live docs (PRD §6.3) before enabling strict rejection.
 */
app.post('/webhooks/nomba', (req, res) => {
  // Verify the nomba-signature header (Nomba signs specific fields, not the raw
  // body). Cheap, synchronous — safe to run before the ACK.
  if (WEBHOOK_KEY) {
    const v = verifyNombaSignature({ body: req.body, getHeader: (n) => req.get(n), key: WEBHOOK_KEY });
    if (v.ok) {
      console.log('[webhook] signature verified ✔');
    } else {
      console.warn('[webhook] signature MISMATCH', {
        received: v.received,
        expected: v.expected,
        signedString: v.signedString,
      });
      if (ENFORCE_SIG) return res.status(401).json({ error: 'invalid signature' });
    }
  }

  res.status(200).json({ received: true }); // ACK first (Nomba 60s gateway timeout)

  const { event_type: eventType, data = {} } = req.body || {};
  console.log(`[webhook] ${eventType}`, JSON.stringify(data).slice(0, 400));

  if (eventType === 'payment_success') {
    // Real inbound-VA payload uses data.transaction.* (confirmed against live
    // docs). There is no merchant orderReference on inbound funding, so Nomba's
    // per-transaction transactionId is our idempotency key. Legacy data.order.*
    // paths kept as fallbacks in case the sandbox shape differs.
    const txn = data.transaction || {};
    const evt = {
      orderReference: txn.transactionId ?? data.order?.orderReference ?? data.orderReference,
      orderId: txn.sessionId ?? data.order?.orderId ?? data.orderId,
      amount: Math.round(
        Number(txn.transactionAmount ?? data.order?.amount ?? data.transactionAmount ?? 0) * 100
      ),
      receivingNuban:
        txn.aliasAccountNumber ?? data.order?.accountNumber ?? data.accountNumber ?? data.receivingAccountNumber,
    };
    try {
      const result = reconcilePayment(evt);
      console.log('[reconcile]', result);
      // TODO: push to dashboard via socket; hand off over/underpayment to edge-case engine.
    } catch (err) {
      console.error('[reconcile] failed', err);
    }
  }
});

/* ------------------------------------------------------------- health */

app.get('/health', (_req, res) => res.json({ ok: true, service: 'dettypot' }));

const PORT = process.env.PORT || 3000;
// Only bind a port when run directly (npm start); tests import the app.
if (require.main === module) {
  app.listen(PORT, () => console.log(`DettyPot listening on :${PORT}`));
}

module.exports = app;
