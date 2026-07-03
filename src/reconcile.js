/**
 * Reconciliation engine — the core of DettyPot.
 *
 * payment_success webhook -> receiving VA -> member -> credit -> pot progress.
 *
 * Guarantees:
 *  - IDEMPOTENT: contributions.order_reference is UNIQUE; a replayed webhook
 *    for the same orderReference is a no-op (never double-counts).
 *  - Misdirected payments (VA not mapped to an active member) are quarantined,
 *    never silently absorbed.
 *  - Over/underpayment is detected against the member's owed amount and
 *    surfaced for the edge-case engine.
 */
const { db, uid, appendLedger } = require('./db');

/**
 * @param {object} evt Normalized webhook payment event:
 *   { orderReference, orderId, amount (kobo), receivingNuban }
 * NOTE: confirm the exact receiving-account field name in the live webhook
 * payload on Day 1 (PRD §6.3) — normalize it in the webhook route, not here.
 */
function reconcilePayment(evt) {
  const { orderReference, orderId, amount, receivingNuban } = evt;

  // 1. Idempotency check — dedupe on OUR orderReference.
  const dupe = db
    .prepare('SELECT id FROM contributions WHERE order_reference = ?')
    .get(orderReference);
  if (dupe) return { status: 'duplicate', contributionId: dupe.id };

  // 2. Attribute: receiving VA -> member.
  const va = db
    .prepare(
      `SELECT va.*, m.id AS member_id, m.pot_id, m.owed, m.paid, m.status AS member_status
       FROM virtual_accounts va JOIN members m ON m.id = va.member_id
       WHERE va.nuban = ? AND va.active = 1`
    )
    .get(receivingNuban);

  if (!va || va.member_status !== 'active') {
    db.prepare(
      'INSERT INTO quarantine (nuban, amount, order_reference, payload) VALUES (?, ?, ?, ?)'
    ).run(receivingNuban, amount, orderReference, JSON.stringify(evt));
    return { status: 'quarantined', nuban: receivingNuban };
  }

  // 3. Credit member + append to ledger (single transaction).
  const contributionId = uid();
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO contributions (id, member_id, pot_id, amount, order_reference, order_id, type)
       VALUES (?, ?, ?, ?, ?, ?, 'credit')`
    ).run(contributionId, va.member_id, va.pot_id, amount, orderReference, orderId ?? null);

    db.prepare('UPDATE members SET paid = paid + ? WHERE id = ?').run(amount, va.member_id);
    const balance = appendLedger(va.pot_id, 'credit', amount, orderReference);
    db.exec('COMMIT');

    // 4. Classify against owed for the edge-case engine.
    const newPaid = va.paid + amount;
    let classification = 'exact';
    if (newPaid > va.owed) classification = 'overpayment';
    else if (newPaid < va.owed) classification = 'underpayment';

    return {
      status: 'credited',
      contributionId,
      memberId: va.member_id,
      potId: va.pot_id,
      potBalance: balance,
      classification,
      excess: Math.max(0, newPaid - va.owed),
      shortfall: Math.max(0, va.owed - newPaid),
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { reconcilePayment };
