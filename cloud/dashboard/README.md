# OpenApiary Fleet Dashboard

Single-file admin dashboard. Open `index.html` in any browser, paste your
`STAGING_ADMIN_KEY` (from `cloud/api/.secrets.local`), click Load.

Calls these endpoints (all gated by `X-Admin-Key`):

- `GET /v1/admin/fleet/stats`     - user / hive / reading counts
- `GET /v1/admin/fleet/hives`     - all hives across users (user IDs anonymised to first 8 chars)
- `GET /v1/admin/fleet/readings`  - last 7 days of cross-user readings (50k row cap)

## Deploying to Cloudflare Pages

```bash
cd cloud/dashboard
npx wrangler pages deploy . --project-name oa-fleet
```

Bind a custom domain like `fleet.openapiary.dev` from the Cloudflare Pages dashboard
when you have the domain configured. Until then the `*.pages.dev` preview URL is fine.

The admin key never leaves the browser - it's stored in `localStorage` and sent only
in the `X-Admin-Key` header to your Worker. Lose your laptop = rotate the key with
`npx wrangler secret put ADMIN_KEY --env staging`.
