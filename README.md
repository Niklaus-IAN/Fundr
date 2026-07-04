# DettyPot 🍯

**Digital ajo with receipts.** A group-contribution pot engine where every member funds through their own dedicated Nomba virtual account, money auto-reconciles into one shared pot in real time, and the messy human reality of group money — overpayment, underpayment, dropouts, cancellations — is handled cleanly end-to-end.

> Nomba × DevCareer Hackathon 2026 · Track: **Virtual Accounts as Infrastructure** · Solo build (Team Fundr)

**Live:** <https://dettypot.onrender.com> — interactive API docs at [`/docs`](https://dettypot.onrender.com/docs) · **21 passing tests** (`npm test`) · naira-facing API.

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

- **Backend:** Node/Express (`src/server.js`), deployed on Render with a live OpenAPI/Swagger UI at [`/docs`](https://dettypot.onrender.com/docs).
- **Nomba client:** auth + proactive token refresh, VA provisioning, transfers (`src/nomba.js`).
- **Webhook security:** `nomba-signature` verification — HMAC-SHA256 over the documented signed fields (`src/webhook-signature.js`); rejects forgeries when enforcement is on.
- **Reconciliation engine:** webhook → VA → member → ledger, idempotent on Nomba's per-transaction id (`src/reconcile.js`).
- **Data:** append-only **ledger is the single source of truth** for pot balance (`src/db.js`). SQLite for dev velocity, schema ports 1:1 to Postgres.
- **Money:** stored and reconciled in **kobo (integer)** for penny-exact arithmetic; the **API speaks naira (₦)** — conversion happens only at the request/response boundary.
- **Planned surface:** Expo/React Native app (web fallback per Day-3 decision gate).

### Data model

`Pot → Members → VirtualAccounts`, with `Contributions` (unique `order_reference` = idempotency) and an append-only `Ledger`. Misdirected payments land in `quarantine` — never silently absorbed.

### API

All amounts are in **naira**. Full interactive reference at [`/docs`](https://dettypot.onrender.com/docs).

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/pots` | create a pot + provision a dedicated VA per member |
| `GET` | `/pots/:id` | live pot dashboard (progress, per-member paid/owed/remaining) |
| `POST` | `/webhooks/nomba` | `payment_success` → verify signature → reconcile |
| `GET` | `/health` | liveness check |

## Reconciliation guarantees (implemented & tested — 21 passing tests)

1. **Verified** — the `nomba-signature` header is checked (HMAC-SHA256 over the documented fields) before a webhook is trusted
2. **Idempotent** — replayed webhooks for the same transaction never double-count
3. **Attributed** — receiving NUBAN → member mapping stored at provisioning time
4. **Classified** — every credit is checked against the member's owed amount: exact / overpayment (excess computed) / underpayment (shortfall computed)
5. **Quarantined** — payments to unmapped VAs are flagged for organizer review

Covered by unit tests (reconciliation + signature) and HTTP integration tests (create-pot → webhook → dashboard). Run `npm test`.

## Run it

```bash
npm install
cp .env.example .env   # add your Nomba sandbox credentials
npm test                         # 21 passing tests (no credentials needed)
node scripts/prove-the-pipe.js   # auth + provision a VA, prints the NUBAN
npm start                        # server + docs + webhook endpoint on :3000
```

Open [`http://localhost:3000/docs`](http://localhost:3000/docs) for the interactive API. Expose `/webhooks/nomba` (deployed on Render, or `ngrok http 3000` locally), register the URL via the hackathon form, send ₦100 to a member's NUBAN from a real bank app, and watch the credit reconcile.

**Deployed:** <https://dettypot.onrender.com> · **API docs:** [`/docs`](https://dettypot.onrender.com/docs) (raw OpenAPI at `/openapi.json`). Requires Node ≥ 24 (built-in `node:sqlite`). See [`DEPLOY.md`](DEPLOY.md).

## Status (Stage-1 progress check)

- [x] PRD complete — see [`docs/`](docs/)
- [x] Data model implemented (Pot, Member, VirtualAccount, Contribution, Ledger, Quarantine)
- [x] Nomba client: auth, token refresh, VA provisioning, transfers — **proven live** (auth + VA provisioning against the sandbox)
- [x] Reconciliation engine with idempotency, over/underpayment classification, quarantine — **21 passing tests**
- [x] Webhook signature verification (`nomba-signature`, HMAC-SHA256)
- [x] Create-pot flow with per-member VA provisioning
- [x] Webhook endpoint (ACK-first per Nomba's 60s gateway timeout)
- [x] Naira-facing API (kobo internal), OpenAPI/Swagger docs at `/docs`
- [x] Deployed live on Render (always-reachable URL)
- [ ] End-to-end webhook credit with a real transfer (URL registered; awaiting Nomba activation)
- [ ] Edge-case engine actions: auto-refund via Transfers, dropout rebalance, cancellation refunds
- [ ] Payout + settlement receipt
- [ ] Mobile/web dashboard

## Out of scope (v1)

Vendor marketplace, social feed, AI planner, loyalty — pitched as v2 vision, not built. **A 100%-complete sharp tool beats a 30%-complete super-app.**
