/**
 * Data layer. Uses Node's built-in SQLite for zero-setup local dev;
 * schema mirrors the PRD data model 1:1 and ports directly to Postgres.
 *
 * The LEDGER is the single source of truth for pot balance:
 * every credit, refund, and payout is an append-only entry.
 */
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

const db = new DatabaseSync(process.env.DB_PATH || 'dettypot.db');

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS pots (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    target INTEGER NOT NULL,              -- kobo
    deadline TEXT,
    split_mode TEXT NOT NULL DEFAULT 'equal',  -- equal | custom
    status TEXT NOT NULL DEFAULT 'open',       -- open | funded | paid_out | cancelled
    payout_destination TEXT,                   -- JSON {accountNumber, bankCode, accountName}
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    pot_id TEXT NOT NULL REFERENCES pots(id),
    name TEXT NOT NULL,
    phone TEXT,
    owed INTEGER NOT NULL,                -- kobo
    paid INTEGER NOT NULL DEFAULT 0,
    refunded INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' -- active | dropped
  );

  CREATE TABLE IF NOT EXISTS virtual_accounts (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES members(id),
    nuban TEXT,                           -- the account number members pay into
    provider_ref TEXT,                    -- our accountRef sent to Nomba
    expected_amount INTEGER,              -- strict mode
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS contributions (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES members(id),
    pot_id TEXT NOT NULL REFERENCES pots(id),
    amount INTEGER NOT NULL,
    order_reference TEXT UNIQUE,          -- OUR idempotency key: dedupe webhooks here
    order_id TEXT,                        -- Nomba's internal UUID from the webhook
    type TEXT NOT NULL,                   -- credit | refund
    status TEXT NOT NULL DEFAULT 'confirmed',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pot_id TEXT NOT NULL REFERENCES pots(id),
    entry_type TEXT NOT NULL,             -- credit | refund | payout | quarantine
    amount INTEGER NOT NULL,              -- signed kobo
    balance_after INTEGER NOT NULL,
    ref TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Payments landing on a VA we can't map to an active member: never silently absorbed.
  CREATE TABLE IF NOT EXISTS quarantine (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nuban TEXT,
    amount INTEGER,
    order_reference TEXT,
    payload TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const uid = () => crypto.randomUUID();

function potBalance(potId) {
  const row = db
    .prepare('SELECT balance_after FROM ledger WHERE pot_id = ? ORDER BY id DESC LIMIT 1')
    .get(potId);
  return row ? row.balance_after : 0;
}

function appendLedger(potId, entryType, amount, ref) {
  const balanceAfter = potBalance(potId) + amount;
  db.prepare(
    'INSERT INTO ledger (pot_id, entry_type, amount, balance_after, ref) VALUES (?, ?, ?, ?, ?)'
  ).run(potId, entryType, amount, balanceAfter, ref ?? null);
  return balanceAfter;
}

module.exports = { db, uid, potBalance, appendLedger };
