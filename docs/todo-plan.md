# OpenApiary — To-Do Plan

> **Status**: Live working document. Supersedes the original `migration-plan.md`.
> **Last updated**: 2026-05-27
> **Repo**: <https://github.com/greadingsuk/openapiary>
> **Licence**: PolyForm Noncommercial 1.0.0

Legend: ✅ done · 🟡 partial / stubbed · ⬜ not started · ⏭️ deferred (won't do in v1)

---

## 1. Workspace & repo

- ✅ Create sibling workspace folder `OpenApiary/`
- ✅ Create public GitHub repo `greadingsuk/openapiary`, clone locally
- ✅ Scaffold monorepo layout: `firmware/`, `app/`, `cloud/api/`, `docs/`, `hardware/`, `.github/workflows/`
- ✅ Drop migration plan into `docs/` (now replaced by **this** file)
- ✅ Initial commit pushed to `main`
- ✅ Licence: PolyForm Noncommercial 1.0.0 (switched from MIT)
- ✅ `README.md`, `CONTRIBUTING.md` reflect PolyForm NC

---

## 2. Hardware

- ✅ **Hardware ordered** (XIAO nRF52840 Standard, LiPo 1000 mAh JST-PH, resistors, ceramics, JST pigtails). Existing v4 BOM reused: load cells, HX711, solar panel, enclosure.
- ⬜ Wire up and bench-test once parts arrive
- ⬜ Update `docs/hardware-build.md` with photos + final pinout
- ⏭️ Hall sensor (A3144) for magnet-triggered cal mode — optional, deferred until v1.1

---

## 3. Firmware (`firmware/`)

### Build & toolchain
- ✅ PlatformIO Core installed (via VS Code extension; invoke as `& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe"`)
- ✅ `platformio.ini` using **maxgerhardt** fork of `platform-nordicnrf52`, `board = xiaoble_adafruit` (Adafruit core, not mbed-seeed)
- ✅ `lib_deps`: `bogde/HX711@^0.7.5` (Bluefruit, InternalFS, TinyUSB come from the Adafruit board core)
- ✅ Firmware compiles cleanly — RAM 5.8 % / Flash 14.2 %

### Source files
- ✅ `src/main.cpp` — wake-cycle skeleton with BLE advert build + start/stop
- ✅ `src/bthome.h` — payload builder + `OA-XXXX` local name from `NRF_FICR->DEVICEADDR`
- ✅ `src/hx711_helper.h` — 10-sample median, spread diagnostic, friction-guard re-read, HX711 power_down/up
- 🟡 `src/cal_mode.cpp` — stub only; CLI not wired up yet

### TODOs before flashing real hardware
- ⬜ **Real System OFF + RTC wake** — replace placeholder `delay(WAKE_INTERVAL_MS)` with `sd_power_system_off()` and RTC compare-match wake (biggest power-budget item)
- ⬜ **InternalFS / LittleFS persistence** for `g_calFactor`, `g_tareOffset`, `g_packetId`
- ⬜ **Calibration CLI** in `cal_mode.cpp`: `tare`, `cal <kg>`, `show`, `reboot` over USB CDC at 115 200 baud
- ⬜ **VBUS detect** at boot → enter cal mode if USB plugged in (skip advert loop)
- ⬜ Wire `enterCalibrationMode()` into `setup()`
- ⏭️ Hall-sensor cal trigger (needs the optional A3144 — deferred)

### Power validation
- ⬜ Once flashed, validate with Nordic PPK II — target <20 µA average

---

## 4. Cloud (`cloud/api/`) — **stubs only, no deployment**

- ✅ Hono Worker stub `src/index.ts` with `X-API-Key` (`timingSafeEqual`) auth
- ✅ Endpoints: `POST /v1/readings`, `GET /v1/hives`, `GET /v1/hives/:id/readings`, `PATCH /v1/hives/:id`
- ✅ D1 schema `migrations/0001.sql` with `UNIQUE(hive_id, packet_id, ts)` and `(hive_id, ts)` index
- ⏭️ `wrangler d1 create openapiary` — deferred until app is ready to sync
- ⏭️ `wrangler secret put API_KEY` / `API_KEY_SALT` — deferred
- ⏭️ `wrangler deploy` — deferred
- ⏭️ Public viewer on Cloudflare Pages — Phase 2

---

## 5. App (`app/`) — Ionic React + Capacitor

- 🟡 Folder exists with README only (interactive `npm create ionic-app@latest` deferred)
- ⬜ Run `npm create ionic-app@latest app -- --type react --capacitor --name openapiary --no-git`
- ⬜ Add deps: `@capacitor-community/bluetooth-le`, `@capacitor-community/sqlite`, `react-chartjs-2`, `chart.js`, `tailwindcss`
- ⬜ `npx cap add ios` / `npx cap add android`
- ⬜ Copy v4 Tailwind tokens + hex motif into `app/tailwind.config.js`
- ⬜ Port `hive-visual.js` → `<HiveVisual />` React component
- ⬜ Local SQLite schema (`hives`, `readings`) per plan §5.5
- ⬜ BTHome v2 service-data parser (mirror `firmware/src/bthome.h`)
- ⬜ Screens: `HiveListPage`, `HiveDetailPage`, `AddHivePage`, `SettingsPage`, `CalibrationHelperPage`
- ⬜ Foreground BLE scan while a hive screen is open (no background scan in v1)
- ⬜ Manual "Sync now" + global "Sync all unsynced" → cloud `POST /v1/readings`
- ⏭️ Background scanning, iOS push notifications — Phase 2

---

## 6. Docs

- ✅ `docs/hardware-build.md` exists (needs photos after build)
- ✅ `docs/home-assistant.md` exists
- ✅ `docs/todo-plan.md` (this file) — single source of truth
- ⬜ Remove old `docs/migration-plan.md` and root-level `OpenApiary-migration-plan.md`

---

## 7. CI (`.github/workflows/`)

- ✅ `firmware.yml` — stub: `pio run`, attach `.hex` / `.uf2` on tag
- ✅ `app.yml` — stub: skips if no `package.json` yet
- ✅ `cloud.yml` — stub: deploys only if `CF_API_TOKEN` secret is set

---

## 8. First-Light Checklist (run in order once hardware arrives)

1. ⬜ `pio run -t upload` succeeds with XIAO in DFU mode (double-tap reset)
2. ⬜ nRF Connect on phone sees `OA-XXXX` advertising ~every 15 min with service-data UUID `0xFCD2`
3. ⬜ nRF Connect (or Home Assistant) decodes weight + battery from BTHome service data
4. ⬜ Home Assistant auto-discovers the device under Settings → Devices
5. ⬜ Cal CLI works over USB: `tare`, `cal 5` (5 kg known weight), `show`
6. ⬜ Ionic app on real device discovers the advert and lets the user name & save the hive
7. ⬜ One wake cycle later, a row appears in the in-app chart
8. ⬜ "Sync now" → `wrangler tail` shows `POST /v1/readings` 200; D1 row visible via `wrangler d1 execute`
9. ⬜ Power Profiler Kit II shows <20 µA average across ≥3 cycles

---

## 9. Open questions (revisit after first light — none block work)

1. App framework — **decided: Ionic React**
2. BTHome encryption — **decided: unencrypted v1** for HA auto-discovery
3. Cloud auth — **decided: single shared API key v1**; JWT / Cloudflare Access later
4. Repo visibility — **decided: public**
5. Power validation — pending PPK II measurement
6. Multi-hive scaling — non-issue (D1 free tier ≈ 280 hive-years)
7. **Phase 2 wishlist**: DS18B20 temperature, public Pages viewer, HA blueprint, voice notes (port v4 voice copilot schema)
8. Local store — **decided: Capacitor SQLite** (not IndexedDB)
9. Long-name in scan response (`OpenApiary-XXXX`) — only if users find `OA-XXXX` unclear

---

## Quick-resume notes (for next session)

- Build firmware: `cd firmware; & "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run`
- Repo: `https://github.com/greadingsuk/openapiary` (public, PolyForm NC)
- Current next action: **finish firmware TODOs in §3** (System OFF, InternalFS, cal CLI) while waiting for parts
