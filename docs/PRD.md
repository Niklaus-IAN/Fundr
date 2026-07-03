# DettyPot — Product Requirements Document

**Nomba × DevCareer Hackathon 2026 · Build Entry (v1)**

**One-liner:** Digital *ajo* with receipts — a group-contribution pot engine where every member funds through their own dedicated Nomba virtual account, money auto-reconciles into one shared pot in real time, and the messy human reality of group money (overpayment, underpayment, dropouts, cancellations) is handled cleanly end-to-end.

**Track:** Virtual Accounts as Infrastructure (Build track)
**Tagline:** Plan Together. Fund Together. Live Together.
**Build window:** 30 June – 7 July 2026 (1 week)
**Submission basis:** Idea-submission form (governs judging) — lock this track before the form closes.

---

## 1. Why this wins (rubric alignment)

The organizers stated plainly what they judge: **end-to-end usability, real-problem-solving, and how far you got versus what you set out to build** — explicitly *not* codebase, architecture, or AI use. This PRD is scoped so that what we *declare* and what we *ship* are the same thing. A 100%-complete sharp tool beats a 30%-complete super-app under this rubric.

The Virtual Accounts track is judged on three things. We map directly:

| Track judging criterion | How DettyPot satisfies it |
|---|---|
| Reconciliation logic quality | Each member has a dedicated VA; inbound transfers auto-attribute to the right member and pot via webhook, live, with no manual matching. |
| Underpayment & overpayment handling | First-class engine: shortfalls tracked + nudged; excess auto-refunded or rolled forward; configurable per pot. |
| Customer-level reporting clarity | Per-member contribution statement, paid/unpaid status, pot progress, and a final settlement receipt. |

The track's own listed example builds include **"Ajo or esusu contribution tracking"** and **"Per-client wallets."** This is not adjacent to the track — it *is* the track.

**The asymmetric prize:** the cash is secondary. A complete, fundable build opens the Nomba Developer Partner Program pathway and a product conversation with Nomba's team. The demo is engineered to make a CTO see a real, monetizable Nigerian primitive.

---

## 2. The problem

Every Nigerian group-money arrangement — *ajo*/*esusu* contributions, group trips, shared rent, joint gifts, event funding — runs on WhatsApp and trust, and breaks the same way: one person fronts the money, chases everyone, manually tracks who paid, eats the shortfall, and has no receipts. There is no system that (a) gives each contributor a clean way to pay, (b) reconciles automatically, (c) handles the inevitable mess, and (d) pays the money out to where it's going.

Splitwise can't move money in Nigeria. PiggyVest saves but doesn't coordinate a group toward a shared spend with payout. **DettyPot is the money rail for group intent.**

---

## 3. Scope — ruthless

### In scope (v1, build week — the complete product)

1. Create a pot: name, target amount, members, optional deadline, contribution mode (equal split or custom per-member amounts).
2. Provision one **dedicated Nomba virtual account per member**, linked to our sub-account.
3. Real-time funding dashboard that updates as money lands (webhook-driven).
4. Reconciliation engine: inbound transfer → correct member → pot progress, automatically.
5. Edge-case engine: overpayment, underpayment, member dropout + rebalance, cancellation refund.
6. Payout: when funded, transfer the pot out to a destination/vendor via Transfers API.
7. Per-member statement + final settlement receipt.
8. WhatsApp-native share: contribution links + live paid/unpaid status to drop into a group chat.
9. Mobile app (Expo / React Native) as the primary surface.

### Out of scope (v1) — pitched as v2 vision, not built

Vendor marketplace · social feed · AI trip planner · DettyCoins loyalty · analytics suite · multi-city expansion. These live in the closing pitch with existing mockups, *not* in the build. Adding any of them to v1 is the fastest way to lose.

---

## 4. Core flow

```
CREATE ──▶ FUND ──▶ RECONCILE ──▶ PAY OUT
  │          │          │            │
 pot +      each      webhook      pot → vendor
 members    member    auto-        via Transfers
 + VAs      transfers attributes   + settlement
            to their  to member +  receipt
            own VA    updates pot
                      live
```

One coherent loop. Every arrow is demoable live in sandbox.

---

## 5. Functional requirements

### 5.1 Pot creation

- Organizer creates a pot: title, target (₦), members (name + phone), deadline (optional), split mode.
- Split mode: **equal** (target ÷ members) or **custom** (per-member amount; must sum to target).
- On creation, system provisions a dedicated VA per member and generates each member's contribution link.

### 5.2 Member funding

- Each member sees: their dedicated NUBAN, their owed amount, their paid amount, and remaining balance.
- Member pays by bank transfer to their dedicated account number (the most familiar Nigerian payment UX — no card friction).
- Optionally set `expectedAmount` on the VA so the account only accepts the exact owed amount (rejects mismatches at source) — offered as a "strict mode" toggle.

### 5.3 Reconciliation (the core)

- On `payment_success` webhook, system identifies the receiving VA → maps to member → credits member's contribution → recomputes pot progress.
- Idempotent: duplicate webhooks for the same `orderReference` never double-count.
- Live dashboard reflects the credit within seconds, no refresh.

### 5.4 Edge-case engine (the wow)

| Case | Behaviour |
|---|---|
| Overpayment | Excess detected against owed amount → auto-refund the difference via Transfers, or roll forward to member's next pot (org-configurable). Logged and shown. |
| Underpayment | Partial credit recorded; member shown remaining balance; pot shows the shortfall; nudge link regenerated. |
| Member dropout | Organizer marks member out → their owed share is auto-redistributed across remaining members (equal mode) and everyone's dashboard updates. |
| Cancellation | Pot cancelled → every contributor auto-refunded their paid amount via Transfers; refund receipts issued. |
| Misdirected payment | Inbound to a VA that doesn't map to an active pot member → quarantined, flagged for organizer review, never silently absorbed. |

### 5.5 Payout

- When pot ≥ target (or organizer triggers early), transfer the pot balance to a destination account (vendor/venue/recipient) via Transfers API.
- Generate a settlement receipt: who paid what, total collected, amount paid out, timestamp, references.

### 5.6 Reporting

- Per-member statement: owed, paid, refunded, status.
- Pot summary: progress %, collected, target, members paid/unpaid.
- Final receipt (shareable / exportable).

---

## 6. Nomba integration spec

> **Source of truth is developer.nomba.com, not the training material** — the organizers confirmed the training docs drifted and contain inaccuracies. Verify every field below against live docs during onboarding.

### 6.1 Account model (confirmed in the session)

- **Parent account ID → authentication only.** Goes in the auth header to obtain the session token. Never used for operations.
- **Sub-account ID → all operations.** Unique to our team. Used to create VAs, fetch transactions, fetch balance. This *is* the pot wallet — a sub-account holds a sitting balance; a virtual account does not.
- **Virtual accounts link to the sub-account, not the parent.** A VA is an interface to receive money; funds landing in a member's VA credit the linked sub-account (the pot).

### 6.2 APIs used

| API | Use in DettyPot |
|---|---|
| Virtual Account API | Provision one dedicated VA per member; set `expectedAmount` in strict mode; expire VA after pot closes via the expiration endpoint. |
| Webhooks | `payment_success` (money in → reconcile), `payout_success` (money out), `refund`. Drives the live dashboard. |
| Transfers | Payout pot → vendor; auto-refunds for overpayment and cancellation. |
| Transactions API | Reconciliation backstop / statement generation; fetch by sub-account ID. |

### 6.3 Webhooks

- **Event for money in:** `payment_success` (a.k.a. payment-sources) — fires when funds land on a VA. `payout_success` fires when money leaves.
- **Signature verification:** *not* an HMAC over the whole raw body — only specific payload fields are used to build the signature. Verification is optional for the hackathon but we implement it (cheap credibility, and it's the production-correct thing). Confirm exact fields against live docs.
- **Idempotency:** there is no separate idempotency key. The `orderReference` we send is the idempotency key. The webhook returns `orderId` (a UUID — Nomba's internal ID; the response field historically named "order reference" is legacy). We match and dedupe on our own `orderReference`.
- **Member attribution:** map the receiving VA (account number) in the webhook payload → member. Store the `VA-number → member-id` mapping at provisioning time. (Confirm the exact receiving-account field name in the live payload.)

### 6.4 Operational constraints (from the session)

- **Gateway timeout: 60s** — keep webhook handlers fast; ACK immediately, process async.
- **Token lifetime ~3h** (read `expiresAt` from the token) — refresh 30–60 min before expiry, don't wait it out.
- Sandbox returns real-looking Nigerian NUBANs; a real ₦100 bank transfer fires a genuine webhook. **Default cap ~2 VAs in sandbox** — request a lift early (we need several for a multi-member demo).
- We already hold production + sandbox credentials — build can start now; webhook registration goes live from 30 June via the form.

---

## 7. Data model

```
Pot            { id, title, target, deadline, split_mode, status, payout_destination }
Member         { id, pot_id, name, phone, owed, paid, refunded, status, va_id }
VirtualAccount { id, member_id, nuban, provider_ref, expected_amount?, active }
Contribution   { id, member_id, pot_id, amount, order_reference, order_id,
                 type[credit|refund], status, created_at }
Ledger         { id, pot_id, entry_type, amount, balance_after, ref, created_at }
```

`Ledger` is the single source of truth for pot balance — every credit, refund, and payout is an append-only entry. This is what makes reconciliation provable in the demo.

---

## 8. Mobile & UX

**Stack:** Expo / React Native (cross-platform, fast to demo). Backend: Node/Express or FastAPI. DB: Postgres. Live updates: webhook → server → push/socket → app.

**Screens (v1):**

1. Create Pot — title, target, members, split mode.
2. Pot Dashboard — live progress ring, member list with paid/unpaid, collected vs target.
3. Member View — my NUBAN, owed, paid, remaining, copy-link / share-to-WhatsApp.
4. Edge events feed — overpayment refunded, member dropped, etc. (visible proof of the engine).
5. Payout & Receipt — trigger payout, settlement receipt.

> Mobile is the recommended surface because "money just landed on my phone" is the wow. If velocity slips during build week, a responsive web app ships complete more reliably — and **complete beats fancy** under this rubric. Decision gate at end of Day 3.

---

## 9. Demo script (5 min) — reconciliation theater

The demo *is* the deliverable that gets judged. Make the live money real.

1. **Hook (30s):** "Every *ajo*, every group trip starts with excitement and ends with one person chasing payments. DettyPot fixes that — with receipts."
2. **Create (45s):** Spin up a pot, add 3 members, equal split. Three dedicated NUBANs appear.
3. **Fund live (90s):** From real bank apps, send small transfers to two members' accounts. Dashboard fills live as webhooks land. Members reconcile automatically — no manual matching.
4. **The mess, handled (90s):** Member 1 overpays → excess auto-refunds on screen. Member 3 drops out → their share auto-redistributes; everyone's owed updates. This is the rubric, live.
5. **Pay out (30s):** Pot hits target → one Transfer pays the vendor → settlement receipt prints.
6. **Vision (45s):** Flash the DettyPot v2 mockups — marketplace, feed, AI planner — "the pot engine is the rail; here's the platform it powers." Close on the loop.

---

## 10. Build plan (7 days)

| Day | Goal |
|---|---|
| 1 | Auth + token refresh; sub-account wired; provision one VA; receive one real sandbox webhook end-to-end. (Prove the pipe.) |
| 2 | Pot + member + VA data model; create-pot flow; per-member VA provisioning; VA→member mapping. |
| 3 | Reconciliation engine + idempotent webhook handler (dedupe on `orderReference`); live dashboard updating. Web-vs-mobile decision gate. |
| 4 | Edge-case engine: overpayment refund, underpayment tracking, dropout rebalance. |
| 5 | Payout via Transfers; cancellation refunds; settlement receipt; per-member statements. |
| 6 | Mobile polish; WhatsApp share links; misdirected-payment quarantine; full dry-run of the demo with real transfers. |
| 7 | Harden, rehearse demo to script, record backup video, submit. |

Build correctness-first. **Cut features before cutting correctness.**

---

## 11. Definition of done (v1)

- [ ] Create a pot with members and per-member dedicated VAs.
- [ ] Live, automatic reconciliation of inbound transfers to the right member.
- [ ] Idempotent webhook handling (no double-counting on replay).
- [ ] Overpayment, underpayment, dropout, cancellation all handled and visible.
- [ ] Payout to destination via Transfers + settlement receipt.
- [ ] Per-member statement + pot reporting.
- [ ] Works end-to-end in sandbox with real bank transfers firing real webhooks.

If all boxes are checked, the build *is* what the idea-submission form declared. That is the win condition.

---

## 12. v2 vision (pitched, not built)

The pot engine is the rail. DettyPot grows into the social outing engine for Nigeria: a vendor marketplace (funded groups → group discounts), a social feed (outing recaps drive the discover→plan→fund→experience→share loop), an AI planner, and DettyCoins loyalty. Revenue: vendor commission, promoted listings, premium tier, transaction fees. *(Reuse existing DettyPot v2 roadmap, mockups, and revenue model for this segment.)*

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| One-week clock, solo build | Scope is the pot core only; decision gate Day 3 drops mobile for web if needed. |
| Training-doc inaccuracies | Treat developer.nomba.com as source of truth; verify every field on Day 1. |
| Webhook attribution field unknown | Confirm receiving-VA field in live payload Day 1; fall back to `expectedAmount` + unique amounts if needed. |
| Sandbox VA cap (~2) | Request lift during onboarding before Day 2. |
| Demo depends on live transfers | Pre-record a clean backup run on Day 7 in case of network/timeout. |
| Over-scoping creep | Marketplace/feed/AI are pitch-only; any v2 feature entering v1 is rejected. |

---

*DettyPot — Plan together. Fund together. Live together.*
