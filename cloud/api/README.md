# OpenApiary Cloudflare Worker

Stateless API in front of a D1 (SQLite) database. Receives reading batches from
the mobile app and serves them back as time-series JSON.

**Isolation:** Lives in the same Cloudflare account as other personal projects
(e.g. Smart Hive Scale) but every resource is prefixed `oa-` so the two never
collide in the dashboard, in `wrangler.toml`, in secrets, or in D1 names.

## Resources this Worker owns

> **Production only.** There is no staging/dev environment for now — everything
> ships live to `production` until the project is stable enough to warrant
> separate targets again.

| Kind | Name | Where defined |
|---|---|---|
| Worker (prod)    | `oa-api-prod`    | `wrangler.toml` `[env.production]` |
| D1 DB (prod)     | `oa-prod`        | `wrangler.toml` `[[env.production.d1_databases]]` |
| Secret | `API_KEY`        | `wrangler secret put` |
| Secret | `API_KEY_SALT`   | `wrangler secret put` |
| Secret | `ADMIN_KEY`      | `wrangler secret put` |

**Live URLs**

| Surface | URL |
|---|---|
| API (primary) | `https://api.openapiary.co.uk` |
| Admin dashboard | `https://openapiary.co.uk` |

## One-time bootstrap

Run from this folder (`cloud/api/`). Cloudflare free tier — no cost.

```powershell
# 0. Install deps (first time only)
npm install

# 1. Authenticate (opens a browser; one-time per machine)
npx wrangler login

# 2. Create the production D1 database
npx wrangler d1 create oa-prod
# Copy the printed database_id into wrangler.toml under [env.production].

# 3. Apply the schema
npm run db:migrate:prod

# 4. Set production secrets (paste a freshly generated random string for each)
#    Generate one with:  -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
npx wrangler secret put API_KEY      --env production
npx wrangler secret put API_KEY_SALT --env production
npx wrangler secret put ADMIN_KEY    --env production

# 5. Deploy
npx wrangler deploy --env production

# 6. Smoke test
$key = '<the API_KEY you set>'
$base = 'https://api.openapiary.co.uk'
Invoke-RestMethod -Uri "$base/v1/hives" -Headers @{ 'X-API-Key' = $key }
```

> **Deploys are manual for now.** The GitHub Actions `cloud` workflow only runs
> if `CF_API_TOKEN` / `CF_ACCOUNT_ID` repo secrets are set; until then, deploy
> from your machine with `npx wrangler deploy --env production`.

## Local dev

```powershell
npm run db:migrate:local   # seeds a local SQLite mirror of the schema
npm run dev                # http://localhost:8787
```

## Day-to-day

| Task | Command |
|---|---|
| Tail logs (prod) | `npm run tail:prod` |
| Quick D1 query (prod) | `npx wrangler d1 execute oa-prod --remote --command "SELECT COUNT(*) FROM readings;"` |
| Rotate API key | `npx wrangler secret put API_KEY --env production`, then update the app |
| New migration | Add `migrations/000N.sql`, run `npm run db:migrate:prod` |

## Why not a separate Cloudflare account?

Free-tier limits are **per account**, not per Worker — a second account doesn't
unlock more capacity and Cloudflare's ToS treats multi-accounting-for-quota as
abuse. Isolation here is by resource naming, per-env secrets, and (optionally)
per-project Cloudflare team members.

## Endpoints

See `src/index.ts`. All `/v1/*` routes require the `X-API-Key` header.

| Method + path | Body / query | Behaviour |
|---|---|---|
| `POST /v1/readings` | `{hiveId, deviceName?, readings: [...]}` | Upserts hive; bulk-inserts readings with `INSERT OR IGNORE` |
| `GET /v1/hives` | — | Lists hives |
| `GET /v1/hives/:id/readings` | `?from=&to=` (unix ms) | Time-windowed readings, ASC |
| `DELETE /v1/hives/:id/readings` | `?ts=<csv>` (optional) | Deletes the listed reading timestamps, or **all** readings for the hive when `ts` is omitted. Idempotent: deleting a hive not in the cloud returns `{ok:true, deleted:0}`; another user's hive is refused with 403. |
| `PATCH /v1/hives/:id` | `{name?, public?, lat?, lon?, region?}` | Update friendly name / public flag / location |
