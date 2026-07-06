# OpenApiary Fleet Dashboard

Single-file admin dashboard. It is live at **https://openapiary.co.uk** (Cloudflare
Pages project `oa-fleet`). You can also open `index.html` locally in any browser.
Paste your production `ADMIN_KEY`, click Load.

Calls these endpoints (all gated by `X-Admin-Key`):

- `GET /v1/admin/fleet/stats`     - user / hive / reading counts
- `GET /v1/admin/fleet/hives`     - all hives across users (user IDs anonymised to first 8 chars)
- `GET /v1/admin/fleet/readings`  - last 7 days of cross-user readings (50k row cap)

## Deploying to Cloudflare Pages

```bash
cd cloud/dashboard
npx wrangler pages deploy . --project-name oa-fleet --branch main
```

The project is bound to the apex domain `openapiary.co.uk`. The `*.pages.dev`
preview URL also works for quick checks.

The admin key never leaves the browser - it's stored in `localStorage` and sent only
in the `X-Admin-Key` header to your Worker. Lose your laptop = rotate the key with
`npx wrangler secret put ADMIN_KEY --env production`.
