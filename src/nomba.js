/**
 * Nomba API client.
 *
 * Auth model (per hackathon onboarding + developer.nomba.com):
 *  - PARENT account ID  -> `accountId` header, used to obtain the access token. Auth only.
 *  - SUB-ACCOUNT ID     -> scopes all operations (VA creation, transactions, balance).
 *  - Token lifetime ~3h -> we refresh proactively 45 min before expiry.
 *
 * NOTE: field names below follow the live docs at developer.nomba.com.
 * The hackathon training material is known to have drifted — verify any
 * mismatch against the live API reference, not the slides.
 */

const BASE_URL = process.env.NOMBA_BASE_URL || 'https://sandbox.nomba.com';

let tokenCache = { accessToken: null, expiresAt: 0 };

const REFRESH_MARGIN_MS = 45 * 60 * 1000; // refresh 45 min early

async function getToken() {
  const now = Date.now();
  if (tokenCache.accessToken && now < tokenCache.expiresAt - REFRESH_MARGIN_MS) {
    return tokenCache.accessToken;
  }

  const res = await fetch(`${BASE_URL}/v1/auth/token/issue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      accountId: process.env.NOMBA_PARENT_ACCOUNT_ID, // parent: auth only
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.NOMBA_CLIENT_ID,
      client_secret: process.env.NOMBA_PRIVATE_KEY,
    }),
  });

  if (!res.ok) {
    throw new Error(`Nomba auth failed: ${res.status} ${await res.text()}`);
  }

  const body = await res.json();
  const data = body.data || body;
  tokenCache = {
    accessToken: data.access_token,
    // Prefer the server's expiresAt; fall back to ~3h
    expiresAt: data.expiresAt ? new Date(data.expiresAt).getTime() : Date.now() + 3 * 60 * 60 * 1000,
  };
  return tokenCache.accessToken;
}

async function nombaFetch(path, { method = 'GET', body } = {}) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      accountId: process.env.NOMBA_PARENT_ACCOUNT_ID,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Nomba ${method} ${path} -> ${res.status}: ${text}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/**
 * Provision a dedicated virtual account for a pot member.
 * The VA is linked to our sub-account: money landing on the member's
 * NUBAN credits the sub-account (the pot wallet).
 */
async function createVirtualAccount({ accountRef, accountName, expectedAmount }) {
  const payload = {
    accountRef,                 // our own idempotent reference (member id)
    accountName,                // shows as beneficiary name in bank apps
    currency: 'NGN',
  };
  if (expectedAmount != null) payload.expectedAmount = expectedAmount; // strict mode
  return nombaFetch('/v1/accounts/virtual', { method: 'POST', body: payload });
}

async function fetchVirtualAccount(accountRef) {
  return nombaFetch(`/v1/accounts/virtual/${accountRef}`);
}

/**
 * Bank transfer out of the sub-account (payouts, refunds).
 * merchantTxRef is our idempotency key — Nomba dedupes on it, and it is
 * what comes back on webhooks as orderReference for matching.
 */
async function transfer({ amount, accountNumber, accountName, bankCode, merchantTxRef, narration }) {
  return nombaFetch('/v1/transfers/bank', {
    method: 'POST',
    body: {
      amount,
      accountNumber,
      accountName,
      bankCode,
      merchantTxRef,
      narration,
      senderName: 'DettyPot',
    },
  });
}

module.exports = { getToken, createVirtualAccount, fetchVirtualAccount, transfer, nombaFetch };
