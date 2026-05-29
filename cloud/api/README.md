# OpenApiary Cloudflare Worker

Stateless API in front of a D1 (SQLite) database. Receives reading batches from
the mobile app and serves them back as time-series JSON.

**Isolation:** Lives in the same Cloudflare account as other personal projects
(e.g. Smart Hive Scale) but every resource is prefixed `oa-` so the two never
collide in the dashboard, in `wrangler.toml`, in secrets, or in D1 names.

## Resources this Worker owns

| Kind | Name | Where defined |
|---|---|---|
| Worker (staging) | `oa-api-staging` | `wrangler.toml` `[env.staging]` |
| Worker (prod)    | `oa-api-prod`    | `wrangler.toml` `[env.production]` |
| D1 DB (staging)  | `oa-staging`     | `wrangler.toml` `[[env.staging.d1_databases]]` |
| D1 DB (prod)     | `oa-prod`        | `wrangler.toml` `[[env.production.d1_databases]]` |
| Secret (each env) | `API_KEY`        | `wrangler secret put` |
| Secret (each env) | `API_KEY_SALT`   | `wrangler secret put` |

## One-time bootstrap

Run from this folder (`cloud/api/`). Cloudflare free tier — no cost.

```powershell
# 0. Install deps (first time only)
npm install

# 1. Authenticate (opens a browser; one-time per machine)
npx wrangler login

# 2. Create the two D1 databases
npx wrangler d1 create oa-staging
npx wrangler d1 create oa-prod
# Copy each printed database_id into wrangler.toml in the matching env block.

# 3. Apply the schema to both
npm run db:migrate:staging
npm run db:migrate:prod

# 4. Set per-env secrets (paste a freshly generated random string for each)
#    Generate one with:  -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
npx wrangler secret put API_KEY      --env staging
npx wrangler secret put API_KEY_SALT --env staging
npx wrangler secret put API_KEY      --env production
npx wrangler secret put API_KEY_SALT --env production

# 5. First deploy (staging)
npm run deploy:staging

# 6. Smoke test
$key = '<the staging API_KEY you set>'
$base = 'https://oa-api-staging.<your-subdomain>.workers.dev'   # only if workers_dev=true
# OR the custom route you bound
Invoke-RestMethod -Uri "$base/v1/hives" -Headers @{ 'X-API-Key' = $key }
```

Production deploy is identical with `--env production` (or `npm run deploy:prod`).

## Local dev

```powershell
npm run db:migrate:local   # seeds a local SQLite mirror of the staging schema
npm run dev                # http://localhost:8787  (uses staging bindings, local DB)
```

## Day-to-day

| Task | Command |
|---|---|
| Tail logs (staging) | `npm run tail:staging` |
| Tail logs (prod) | `npm run tail:prod` |
| Quick D1 query (prod) | `npx wrangler d1 execute oa-prod --remote --command "SELECT COUNT(*) FROM readings;"` |
| Rotate API key | `npx wrangler secret put API_KEY --env production`, then update the app |
| New migration | Add `migrations/000N.sql`, run `npm run db:migrate:staging`, verify, then `db:migrate:prod` |

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
| `PATCH /v1/hives/:id` | `{name?, public?}` | Update friendly name / public flag |
