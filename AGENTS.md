# Agent working rules — Open Apiary

These rules apply to any AI agent/session working in this repository.

## Build & commit workflow (IMPORTANT)

1. **Ask before building.** Do NOT run an app build (`npm run build`) or a
   firmware build/flash (`pio run` / `-t upload`) on your own. First ask the
   user, because there may be several changes to batch before a build. Wait for
   their go-ahead.
2. **Commit AND PUSH at the build point.** iOS builds run on a *separate Mac*
   via `app/build-ios.sh`, which **`git pull`s `origin/main`** before it builds.
   So a change only reaches a build once it is committed **and pushed** — an
   uncommitted or unpushed working-tree edit is invisible to the Mac build.
   (This bit us once: a restored UI control "didn't appear" because it was left
   uncommitted on the other machine.) Never assume local edits ship.
3. **Batch work between builds.** Prefer making all the related edits, then a
   single build + commit + push, rather than build-per-change.

## Current architecture — ground truth (read before touching OTA / cloud / firmware)

Two parallel sessions previously diverged on these. They are settled — do not
re-derive or reintroduce the old versions:

- **DFU = legacy Nordic DFU** (Adafruit nRF52 bootloader, SDK 11), client in
  `app/src/lib/dfu.ts`; full reference `docs/firmware-ota.md`. It is **NOT**
  Nordic Secure DFU — do not reintroduce Secure-DFU UUIDs (`0xFE59` / `8ec9…`).
- **Production API = `https://api.openapiary.co.uk`** (Worker `oa-api-prod`,
  D1 `oa-prod`); production-only, staging retired. The old
  `api.openapiaryproject.com` is **decommissioned / dead** — do not reference,
  add, or "fall back" to it anywhere.
- **Web:** admin dashboard (Pages `oa-fleet`, `openapiary.co.uk`) and the user
  site (Pages `oa-web`) both call `api.openapiary.co.uk`.
- **Versions:** firmware + app track together via `firmware/src/version.h` and
  `CURRENT_BUILD` in `app/src/lib/ota.ts` (currently v1.0.9). The *published* OTA
  target can lag the source until a release is cut (`tools/firmware-release/`).
- **v1.0.9 firmware:** on-device reading log (`firmware/src/reading_log.h`) +
  heartbeat/measurement split; the app drains history over BLE
  (`app/src/lib/history.ts`). Advert is connectable+scannable with a ~6 s service
  window each ~60 s heartbeat (not non-connectable).
- **Tare & calibration persist to flash immediately** in the GATT write handlers
  (`firmware/src/gatt_config.h`) so a reboot (e.g. overnight brown-out) can't
  revert them to defaults.

## Notes for context

- App: Ionic React + Capacitor in `app/`. Build = `npm run build` (from `app/`).
- Firmware: PlatformIO in `firmware/`. Build = `pio run -e xiaoble`; flash =
  `pio run -e xiaoble -t upload` (device on USB enters calibration mode).
- Cloud: Cloudflare Worker in `cloud/api/` — production only, deploy with
  `npx wrangler deploy --env production` (manual; no CI secrets set).
- Firmware version lives in `firmware/src/version.h`; keep `CURRENT_BUILD` in
  `app/src/lib/ota.ts` in sync. OTA releases are signed GitHub releases on
  `greadingsuk/openapiary` (see `tools/firmware-release/`).
