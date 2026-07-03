require('dotenv').config({ quiet: true });
const express = require('express');
const { db, uid, potBalance } = require('./db');
const { reconcilePayment } = require('./reconcile');
const nomba = require('./nomba');

const app = express();
app.use(express.json());

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
  res.status(200).json({ received: true }); // ACK first

  const { event_type: eventType, data = {} } = req.body || {};
  console.log(`[webhook] ${eventType}`, JSON.stringify(data).slice(0, 400));

  if (eventType === 'payment_success') {
    // Normalize payload -> reconciliation event.
    // NOTE: confirm exact field names (receiving account number especially)
    // against the live webhook payload — training docs are known to drift.
    const evt = {
      orderReference: data.order?.orderReference ?? data.orderReference,
      orderId: data.order?.orderId ?? data.orderId,
      amount: Math.round(Number(data.order?.amount ?? data.transactionAmount ?? 0) * 100),
      receivingNuban:
        data.order?.accountNumber ?? data.accountNumber ?? data.receivingAccountNumber,
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
