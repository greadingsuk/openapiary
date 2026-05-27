# OpenApiary

> Open-source BLE beehive scale. A Seeed XIAO nRF52840 reads four load cells
> through an HX711, broadcasts the weight as an [unencrypted BTHome v2](https://bthome.io/format/)
> advert every 15 minutes, and goes back to sleep. A phone app (Ionic + Capacitor)
> listens passively, stores readings locally, and optionally syncs them to a
> Cloudflare Worker backed by D1 (SQLite).

No Wi-Fi. No cloud account required to use the device. No vendor lock-in.
Auto-discovered by Home Assistant out of the box.

## Repo layout

| Path        | What lives here |
|-------------|-----------------|
| `firmware/` | PlatformIO project for the XIAO nRF52840 (Arduino framework + Bluefruit) |
| `app/`      | Ionic React + Capacitor app — currently a stub, see `app/README.md` |
| `cloud/`    | Cloudflare Worker (Hono) + D1 schema |
| `docs/`     | Migration plan, hardware build guide, Home Assistant notes |
| `hardware/` | CAD, BOM, wiring diagrams |

## Quickstart

See [`docs/migration-plan.md`](docs/migration-plan.md) for the full build plan.
Short version:

1. **Firmware** — open `firmware/` in VS Code with the PlatformIO extension, hit Build, double-tap reset on the XIAO and Upload.
2. **App** — follow `app/README.md` to finish the Ionic scaffold, then `npm run dev`.
3. **Cloud** *(optional)* — `cd cloud/api && npm install && npx wrangler d1 create openapiary` then fill in `wrangler.toml` and `npx wrangler deploy`.

## Status

Phase 1 scaffold. Not yet flashed to hardware. See [`docs/migration-plan.md` §8](docs/migration-plan.md) for the first-light checklist.

## Licence

MIT — see [`LICENSE`](LICENSE).
