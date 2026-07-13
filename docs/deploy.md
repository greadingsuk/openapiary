# Build & deploy runbook — app and websites

Authoritative steps for building the mobile app and deploying the two websites
(admin dashboard + user site) and the Worker API they talk to. For the firmware
OTA release process see [firmware-ota.md](firmware-ota.md).

> **Golden rule — commit *and push* first.** iOS builds run on a *separate Mac*
> and the Worker/Pages deploys read from your working tree, but the Mac build
> `git pull`s `origin/main`. A change only ships once it is committed **and
> pushed**. Never assume a local edit is live. (See `AGENTS.md`.)

---

## 1. App (Ionic React + Capacitor)

### Web bundle (used by every target)

```bash
cd app
npm install
npm run build        # -> app/dist  (Vite production bundle)
```

### iOS (on the Mac)

The Mac is the only machine that can produce an iOS build. One command does the
whole thing:

```bash
cd app
./build-ios.sh              # pull origin/main, npm install, build, icons, cap sync, open Xcode
./build-ios.sh --no-pull    # build what's on disk (skip the git pull)
```

Then in Xcode: pick your iPhone as the run destination and press ▶ (Cmd+R).

Notes:
- `build-ios.sh` **stashes local changes, `git pull --rebase origin main`,** then
  restores the stash — so anything not pushed from the Windows machine is *not*
  in the build. Push before you build.
- It re-generates the app icon/splash (`npm run icons`) and runs `npx cap sync ios`.
- It auto-restores the Bluetooth privacy keys in `App/Info.plist` if Xcode's
  settings migration strips them (this silently kills the BLE permission prompt).
- Each run appends a row to `logs/ios-build-runs.tsv` and pushes it (disable with
  `OA_LOG_TO_GIT=0`).

### Android

```bash
cd app
npm run build
npx cap sync android
npx cap open android        # then build/run from Android Studio
```

---

## 2. Worker API (`cloud/api/`)

Production only — staging is retired. Deploys are **manual** (no CI secrets set).

```bash
cd cloud/api
npm install
npx wrangler deploy --env production
```

- Worker `oa-api-prod`, D1 database `oa-prod`, custom domain
  **`https://api.openapiary.co.uk`**.
- Run D1 migrations when the schema changes (see `cloud/api/README.md` /
  `package.json` scripts, e.g. `npm run db:migrate:prod`).
- Rotate the admin key: `npx wrangler secret put ADMIN_KEY --env production`.

---

## 3. Admin dashboard (`cloud/dashboard/` — Pages `oa-fleet`)

Single-file admin console, live at **https://openapiary.co.uk** (apex domain).

```bash
cd cloud/dashboard
npx wrangler pages deploy . --project-name oa-fleet --branch main
```

- Calls `api.openapiary.co.uk` admin endpoints, gated by the `X-Admin-Key`
  header. The key is stored only in the browser's `localStorage`.
- The `*.pages.dev` preview URL also works for quick checks.

---

## 4. User site (`cloud/usersite/` — Pages `oa-web`)

Single-file user-facing site (login + charts + weight×temperature correlation).
Talks to `api.openapiary.co.uk`.

```bash
cd cloud/usersite
npx wrangler pages deploy . --project-name oa-web --branch main
```

- Custom domain binding is managed in the Cloudflare Pages dashboard for the
  `oa-web` project.

---

## Quick reference

| Target        | Directory         | Command |
|---------------|-------------------|---------|
| App web build | `app/`            | `npm run build` |
| App iOS       | `app/` (Mac)      | `./build-ios.sh` |
| App Android   | `app/`            | `npm run build && npx cap sync android && npx cap open android` |
| Worker API    | `cloud/api/`      | `npx wrangler deploy --env production` |
| Dashboard     | `cloud/dashboard/`| `npx wrangler pages deploy . --project-name oa-fleet --branch main` |
| User site     | `cloud/usersite/` | `npx wrangler pages deploy . --project-name oa-web --branch main` |

All three web/cloud deploys are **manual** and run from your machine — there is
no CI trigger unless `CF_API_TOKEN` / `CF_ACCOUNT_ID` repo secrets are added.
