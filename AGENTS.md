# Agent working rules — Open Apiary

These rules apply to any AI agent/session working in this repository.

## Build & commit workflow (IMPORTANT)

1. **Ask before building.** Do NOT run an app build (`npm run build`) or a
   firmware build/flash (`pio run` / `-t upload`) on your own. First ask the
   user, because there may be several changes to batch before a build. Wait for
   their go-ahead.
2. **Commit at the build point.** When the user approves a build, that is also
   the point to commit (and push) the batched changes. Don't leave approved,
   built work uncommitted.
3. **Batch work between builds.** Prefer making all the related edits, then a
   single build + commit, rather than build-per-change.

## Notes for context

- App: Ionic React + Capacitor in `app/`. Build = `npm run build` (from `app/`).
- Firmware: PlatformIO in `firmware/`. Build = `pio run -e xiaoble`; flash =
  `pio run -e xiaoble -t upload` (device on USB enters calibration mode).
- Cloud: Cloudflare Worker in `cloud/api/` — production only, deploy with
  `npx wrangler deploy --env production` (manual; no CI secrets set).
- Firmware version lives in `firmware/src/version.h`; keep `CURRENT_BUILD` in
  `app/src/lib/ota.ts` in sync. OTA releases are signed GitHub releases on
  `greadingsuk/openapiary` (see `tools/firmware-release/`).
