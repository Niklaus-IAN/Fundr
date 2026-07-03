/**
 * Day 1 goal, compressed: prove the pipe.
 *   1. Authenticate against Nomba sandbox (parent accountId + client creds)
 *   2. Provision one virtual account
 *   3. Print the NUBAN — send ₦100 to it from a real bank app and watch
 *      the webhook land on /webhooks/nomba.
 *
 * Run:  node scripts/prove-the-pipe.js
 */
require('dotenv').config({ quiet: true });
const nomba = require('../src/nomba');
const crypto = require('node:crypto');

(async () => {
  console.log('1/3 Authenticating with Nomba…');
  await nomba.getToken();
  console.log('    ✔ token acquired');

  console.log('2/3 Provisioning a test virtual account…');
  const ref = `pipe-test-${crypto.randomUUID().slice(0, 8)}`;
  const va = await nomba.createVirtualAccount({
    accountRef: ref,
    accountName: 'DettyPot/PipeTest',
  });
  const d = va.data || va;
  console.log('    ✔ VA created');
  console.log(`      accountRef : ${ref}`);
  console.log(`      NUBAN      : ${d.bankAccountNumber}`);
  console.log(`      bank       : ${d.bankName}`);

  console.log('3/3 Now: start the server (npm start), expose it (ngrok http 3000),');
  console.log('    submit the webhook URL via the hackathon form, and send ₦100');
  console.log('    to the NUBAN above. Watch the payment_success webhook land.');
})().catch((err) => {
  console.error('✘ Pipe test failed:', err.message);
  process.exit(1);
});
