/**
 * Nomba webhook signature verification.
 *
 * Nomba does NOT sign the raw request body. It signs a colon-joined string of
 * specific fields (confirmed against developer.nomba.com/docs/api-basics/webhook):
 *
 *   event_type : requestId : userId : walletId :
 *   transactionId : type : time : responseCode : nomba-timestamp
 *
 * then computes HMAC-SHA256 with the webhook signing key and Base64-encodes it.
 * The result is delivered in the `nomba-signature` header (also mirrored in
 * `nomba-sig-value`); the algorithm is named in `nomba-signature-algorithm`.
 *
 * Field JSON paths in the payload:
 *   event_type    -> body.event_type
 *   requestId     -> body.requestId
 *   userId        -> body.data.merchant.userId
 *   walletId      -> body.data.merchant.walletId
 *   transactionId -> body.data.transaction.transactionId
 *   type          -> body.data.transaction.type
 *   time          -> body.data.transaction.time
 *   responseCode  -> body.data.transaction.responseCode
 *   nomba-timestamp -> request header
 */
const crypto = require('node:crypto');

/** Rebuild the exact string Nomba signs, from the parsed body + a header getter. */
function buildSignedString(body, getHeader) {
  const d = (body && body.data) || {};
  const m = d.merchant || {};
  const t = d.transaction || {};
  const parts = [
    body && body.event_type,
    body && body.requestId,
    m.userId,
    m.walletId,
    t.transactionId,
    t.type,
    t.time,
    t.responseCode,
    getHeader('nomba-timestamp'),
  ];
  // Java's String.format renders a missing value as an empty field, not "null".
  return parts.map((v) => (v == null ? '' : String(v))).join(':');
}

/**
 * @returns {{ ok: boolean, expected: string, received: string|null, signedString: string }}
 */
function verifyNombaSignature({ body, getHeader, key }) {
  const received = getHeader('nomba-signature') || getHeader('nomba-sig-value') || null;
  const signedString = buildSignedString(body, getHeader);
  const expected = crypto.createHmac('sha256', key).update(signedString).digest('base64');

  let ok = false;
  if (received) {
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return { ok, expected, received, signedString };
}

module.exports = { verifyNombaSignature, buildSignedString };
