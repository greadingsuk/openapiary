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

## PRs

- Small, focused PRs preferred.
- Run the build for whichever subproject you touched before pushing.
- Reference the section of `docs/migration-plan.md` you're implementing in the
  PR description.
