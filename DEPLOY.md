# Deploying DettyPot (Render — free, always-reachable)

The backend runs as a persistent Node process, so it deploys cleanly to Render's
free web-service tier with a stable HTTPS URL. A [`render.yaml`](render.yaml)
Blueprint is included so setup is close to one click.

## Steps

1. Go to <https://dashboard.render.com> and sign in (GitHub login is easiest).
2. **New +  →  Blueprint**.
3. Connect / select the repository **`Niklaus-IAN/Fundr`**. Render detects
   [`render.yaml`](render.yaml) automatically.
4. Render prompts for the secret env vars (marked `sync: false`). Paste your
   **TEST** Nomba credentials:
   - `NOMBA_PARENT_ACCOUNT_ID`
   - `NOMBA_SUB_ACCOUNT_ID`
   - `NOMBA_CLIENT_ID`
   - `NOMBA_PRIVATE_KEY`
   (The non-secret vars — base URL, signing key, Node version — are already set
   in the Blueprint.)
5. **Apply / Create**. First build takes ~2–3 min.
6. You get a permanent URL like `https://dettypot.onrender.com`.
   Your webhook endpoint is `https://dettypot.onrender.com/webhooks/nomba`.

## After deploy

- **Re-register the webhook** with the new permanent URL via the Nomba form
  (replaces the temporary tunnel URL).
- Verify it's up: open `https://<your-app>.onrender.com/health` → `{"ok":true}`.
- **Warm it before a live test.** The free tier sleeps after ~15 min idle and
  cold-starts (~30s) on the next request; hit `/health` first so Nomba's webhook
  isn't the request that pays the cold-start cost.
- Once a real signed webhook logs `signature verified ✔`, set
  `WEBHOOK_ENFORCE_SIGNATURE=true` in the Render dashboard to reject forgeries.

## Notes / limits (free tier)

- **Ephemeral disk** — the SQLite DB resets on each deploy or wake-from-sleep.
  Fine for a live demo (create a pot, then test in the same session). For durable
  storage, migrate to a hosted Postgres (the schema in [`src/db.js`](src/db.js)
  ports 1:1) — deferred, not required for Stage 1.
- **Node 24** is pinned ([`.node-version`](.node-version) + `engines`) because the
  data layer uses the built-in `node:sqlite` module.
