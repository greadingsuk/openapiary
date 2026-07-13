# OpenApiary

> Open-source BLE beehive scale. A Seeed XIAO nRF52840 reads four load cells
> through an HX711, broadcasts the weight as an [unencrypted BTHome v2](https://bthome.io/format/)
> advert as a ~1-minute heartbeat, logs a full weight/temperature reading every
> 15 min (hourly overnight) to an on-device log it can replay to the app, then
> sleeps. A phone app (Ionic + Capacitor)
> listens passively, stores readings locally, and optionally syncs them to a
> Cloudflare Worker backed by D1 (SQLite).

No Wi-Fi. No cloud account required to use the device. No vendor lock-in.
Auto-discovered by Home Assistant out of the box.

## Repo layout

| Path        | What lives here |
|-------------|-----------------|
| `firmware/` | PlatformIO project for the XIAO nRF52840 (Arduino framework + Bluefruit) |
| `app/`      | Ionic React + Capacitor app (BLE scan/pair, local SQLite cache, sync, charts, rename/time push) |
| `cloud/`    | Cloudflare Worker (Hono) + D1 schema |
| `docs/`     | Live to-do plan, hardware build guide, Home Assistant notes |
| `hardware/` | CAD, BOM, wiring diagrams |

## Quickstart

See [`docs/todo-plan.md`](docs/todo-plan.md) for the live build plan and current status.
Short version:

1. **Firmware** — open `firmware/` in VS Code with the PlatformIO extension, hit Build, double-tap reset on the XIAO and Upload.
2. **App** — `cd app && npm install && npm run dev` for local dev, or `npm run build` to produce a release build.
3. **Cloud** *(optional for local-only use)* — `cd cloud/api && npm install`, run D1 migrations, then deploy via Wrangler.

For full build & deploy steps (iOS app, Worker API, admin dashboard, user site)
see [`docs/deploy.md`](docs/deploy.md). Firmware OTA releases: [`docs/firmware-ota.md`](docs/firmware-ota.md).

## Status

- Firmware (v1.0.9): 1-min heartbeat advert + on-device reading log (15-min / hourly) drained over BLE; pairing-window GATT config (rename / time / tare / calibrate / diagnostics); tare & calibration persist to flash immediately.
- App: BLE scanning, local SQLite buffering, cloud sync (opt-in), long-range charts, device rename, apiary management, on-site **guided tare wizard**, stand accuracy check, and **delete readings** (single, multi-select "Select all", or delete-all) implemented.
- Cloud: **production only** — Worker `oa-api-prod` + D1 `oa-prod`, admin dashboard live. No staging/dev environment for now; everything ships live until stable.

### Live URLs

| Surface | URL |
|---|---|
| API | `https://api.openapiary.co.uk` |
| Admin dashboard | `https://openapiary.co.uk` |

See [`docs/todo-plan.md` §8](docs/todo-plan.md#8-first-light-checklist-run-in-order-once-hardware-arrives) for the runbook checklist.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE) — free to use, modify and share for
non-commercial purposes (personal projects, research, education, charities,
government). Commercial use requires a separate licence — contact the
author.
