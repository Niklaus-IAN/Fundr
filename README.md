# DettyPot 🍯

**Digital ajo with receipts.** A group-contribution pot engine where every member funds through their own dedicated Nomba virtual account, money auto-reconciles into one shared pot in real time, and the messy human reality of group money — overpayment, underpayment, dropouts, cancellations — is handled cleanly end-to-end.

> Nomba × DevCareer Hackathon 2026 · Track: **Virtual Accounts as Infrastructure** · Solo build (Team Fundr)

## The problem

Every Nigerian group-money arrangement — ajo/esusu, group trips, shared rent, joint gifts — runs on WhatsApp and trust, and breaks the same way: one person fronts the money, chases everyone, manually tracks who paid, eats the shortfall, and has no receipts. Splitwise can't move money in Nigeria; PiggyVest saves but doesn't coordinate a group toward a shared spend with payout. **DettyPot is the money rail for group intent.**

## The loop

```
CREATE ──▶ FUND ──▶ RECONCILE ──▶ PAY OUT
  pot +     each      webhook        pot →
 members   member    auto-attributes vendor via
 + VAs     pays own  to member,      Transfers +
           NUBAN     updates pot     settlement
                     live            receipt
```

## How it maps to the track rubric

| Track criterion | DettyPot |
|---|---|
| Reconciliation logic quality | One dedicated VA per member; `payment_success` webhooks auto-attribute to the right member and pot — idempotent, live, no manual matching |
| Under/overpayment handling | First-class engine: shortfalls tracked + nudged; excess auto-refunded or rolled forward (configurable) |
| Customer-level reporting | Per-member statement, paid/unpaid status, pot progress, final settlement receipt |

## Architecture

- **Backend:** Node/Express (`src/server.js`)
- **Nomba client:** auth + proactive token refresh, VA provisioning, transfers (`src/nomba.js`)
- **Reconciliation engine:** webhook → VA → member → ledger, idempotent on `orderReference` (`src/reconcile.js`)
- **Data:** append-only **ledger is the single source of truth** for pot balance (`src/db.js`). SQLite for dev velocity, schema ports 1:1 to Postgres.
- **Planned surface:** Expo/React Native app (web fallback per Day-3 decision gate)

### Data model

`Pot → Members → VirtualAccounts`, with `Contributions` (unique `order_reference` = idempotency) and an append-only `Ledger`. Misdirected payments land in `quarantine` — never silently absorbed.

## Reconciliation guarantees (implemented & tested)

1. **Idempotent** — replayed webhooks for the same `orderReference` never double-count
2. **Attributed** — receiving NUBAN → member mapping stored at provisioning time
3. **Classified** — every credit is checked against the member's owed amount: exact / overpayment (excess computed) / underpayment (shortfall computed)
4. **Quarantined** — payments to unmapped VAs are flagged for organizer review

## Run it

```bash
npm install
cp .env.example .env   # add your Nomba sandbox credentials
node scripts/prove-the-pipe.js   # auth + provision a VA, prints the NUBAN
npm start                        # server + webhook endpoint on :3000
```

Expose `/webhooks/nomba` (e.g. `ngrok http 3000`), register the URL via the hackathon form, send ₦100 to the printed NUBAN from a real bank app, and watch the credit reconcile.

**API docs:** interactive Swagger UI at [`/docs`](https://dettypot.onrender.com/docs) (raw OpenAPI at `/openapi.json`). Live deploy: <https://dettypot.onrender.com>.

## Status (Stage-1 progress check)

- [x] PRD complete — see [`docs/`](docs/)
- [x] Data model implemented (Pot, Member, VirtualAccount, Contribution, Ledger, Quarantine)
- [x] Nomba client: auth, token refresh, VA provisioning, transfers
- [x] Reconciliation engine with idempotency, over/underpayment classification, quarantine — unit-verified
- [x] Create-pot flow with per-member VA provisioning
- [x] Webhook endpoint (ACK-first per Nomba's 60s gateway timeout)
- [ ] End-to-end sandbox webhook test with a real transfer (webhook URL registration pending)
- [ ] Edge-case engine actions: auto-refund via Transfers, dropout rebalance, cancellation refunds
- [ ] Payout + settlement receipt
- [ ] Mobile/web dashboard

## Out of scope (v1)

Vendor marketplace, social feed, AI planner, loyalty — pitched as v2 vision, not built. **A 100%-complete sharp tool beats a 30%-complete super-app.**
