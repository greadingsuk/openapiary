# Contributing to OpenApiary

Thanks for your interest! This project is small, hobbyist-run, and welcomes
contributions of any size.

## Ground rules

- **No secrets in commits.** No API keys, tokens, customer names, MAC addresses
  tied to real users, or photos with identifiable plate / location data.
- **PolyForm Noncommercial 1.0.0.** By contributing you agree your contributions
  are released under the project's [LICENSE](LICENSE) (non-commercial use only).
- **Keep it open.** Avoid pulling in proprietary SDKs or cloud-only services
  on the device side.

## Project layout

See [`README.md`](README.md) for the monorepo layout.

## Firmware

- Install [PlatformIO](https://platformio.org/) (CLI or VS Code extension).
- `cd firmware && pio run` to build.
- Flash by double-tapping reset on the XIAO and running `pio run -t upload`.

## App

- See [`app/README.md`](app/README.md) — the Ionic scaffold needs to be completed
  interactively the first time.

## Cloud

- `cd cloud/api && npm install`.
- Create your own D1 instance: `npx wrangler d1 create openapiary` and paste the
  ID into `wrangler.toml`.
- Set the `API_KEY` secret with `npx wrangler secret put API_KEY`.
- `npx wrangler dev` for local, `npx wrangler deploy` for prod.

## Dependency policy — NPM minimum release age (7-day quarantine)

Some managed developer machines (e.g. Microsoft Corp devices) enforce an npm
`min-release-age=7` policy. When set, `npm install` **skips any package version
published in the last 7 days** and resolves to the most recent version that is at
least 7 days old. It's a supply-chain safeguard: most malicious npm releases
(e.g. the Shai-Hulud / chalk-debug and Miasma incidents) are detected and pulled
within days, so a 7-day hold lets bad versions be caught before they land. You'll
see it as a harmless `npm warn Unknown global config "min-release-age"` line.

What it means for this repo:

- **Lockfiles are unaffected.** Versions already pinned in `package-lock.json`
  are older than 7 days, so `npm ci` / installs from the lockfile behave normally.
  Committing the lockfile is what keeps everyone reproducible.
- **New/updated deps resolve to a ≥7-day-old version.** This is usually fine and
  is the behaviour we want.
- **Adding a brand-new package or a just-published fix can fail** ("no matching
  version") until it ages past 7 days.

Working pattern (work *with* the quarantine, never bypass it):

1. Prefer stable, established packages; avoid depending on bleeding-edge releases.
2. Build a **7-day buffer** into any dependency bump — plan upgrades ahead of a
   release rather than pulling a version the day it ships.
3. If an install is blocked, wait for the version to age out, or pin the most
   recent version that is already ≥ 7 days old.
4. **Do not** disable, override, or work around the control (e.g. `min-release-age=0`,
   private mirrors to dodge it). On corporate devices that's a security-policy
   violation — for a genuine urgent need, go through the official channel
   (Microsoft: `globalhd@microsoft.com`) instead.
5. Keep dependency counts low. Every new dep is both a supply-chain surface and a
   potential 7-day scheduling snag (it's why the OTA work uses `fflate` + Web
   Crypto rather than heavier crypto libraries).

## PRs

- Small, focused PRs preferred.
- Run the build for whichever subproject you touched before pushing.
- Reference the section of `docs/migration-plan.md` you're implementing in the
  PR description.
