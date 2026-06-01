# OpenApiary — To-Do Plan

> **Status**: Live working document. Supersedes the original `migration-plan.md`.
> **Last updated**: 2026-06-01
> **Repo**: <https://github.com/greadingsuk/openapiary>
> **Licence**: PolyForm Noncommercial 1.0.0

Legend: ✅ done · 🟡 partial / stubbed · ⬜ not started · ⏭️ deferred (won't do in v1)

---

## 0. Architecture (source-of-truth model)

OpenApiary follows the **Smartbot-style** model: the cloud is canonical, the phone is
an offline cache + sync client. Devices never talk to the cloud directly.

```
XIAO scale  ──BLE advert──►  Phone (Ionic app)
                              │
                              ├─► Local SQLite (offline buffer; rows start synced=0)
                              │
                              └─► When online: POST /v1/readings
                                           │
                                           ▼
                                  Cloudflare Worker (oa-api-*)
                                           │
                                           ▼
                                  D1 database (oa-staging / oa-prod)  ◄── canonical store
                                           │
                                           ▼
                                  Read back by any phone or web viewer
```

**Implications baked into the design:**

- Every BLE advert the phone hears is written to local SQLite *immediately* with `synced=0`.
- A row is only flipped to `synced=1` after a confirmed HTTP 200 from the Worker.
- Long-range charts in the app read from the Worker (D1) when online; fall back to local cache offline.
- Cloud is **mandatory infrastructure**, not optional. A phone wipe before sync = the last few unsynced rows lost; mitigated by aggressive auto-sync (see §5).
- The device itself stays internet-free — BLE only. This keeps the firmware tiny and the power budget intact.

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
- ✅ Load cells wired into HXT combinator board (bathroom-scale full-Wheatstone pattern; see [hardware-wiring.md](hardware-wiring.md)). Resistance checks match the working personal hive-scale build (~1 Ω E+/E−, ~2 Ω A+/A−).
- ⬜ Solder XIAO ↔ HX711 (3V3, GND, DT=D2, SCK=D3) and LiPo to BAT/GND
- ⬜ First power-on: VBUS → cal mode → `tare`, `cal <kg>`, corner sanity check
- ⬜ Update `docs/hardware-build.md` with photos
- ⏭️ Hall sensor (A3144) for magnet-triggered cal mode — optional, deferred until v1.1

---

## 3. Firmware (`firmware/`)

### Build & toolchain
- ✅ PlatformIO Core installed (via VS Code extension; invoke as `& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe"`)
- ✅ `platformio.ini` using **maxgerhardt** fork of `platform-nordicnrf52`, `board = xiaoble_adafruit` (Adafruit core, not mbed-seeed)
- ✅ `lib_deps`: `bogde/HX711@^0.7.5` (Bluefruit, InternalFS, TinyUSB come from the Adafruit board core)
- ✅ Firmware compiles cleanly — RAM 5.8 % / Flash 15.4 %

### Source files
- ✅ `src/main.cpp` — wake cycle, VBUS-gated cal mode entry, DCDC enable, persist load + per-N-cycle save
- ✅ `src/bthome.h` — payload builder + `OA-XXXX` local name from `NRF_FICR->DEVICEADDR`
- ✅ `src/hx711_helper.h` — 10-sample median, spread diagnostic, friction-guard re-read, HX711 power_down/up, raw-read helpers for cal mode
- ✅ `src/persist.h` — InternalFS / LittleFS wrapper, `/cal.txt` plain-text store
- ✅ `src/cal_mode.cpp` — USB-CDC CLI: `tare`, `cal <kg>`, `show`, `save`, `reboot`

### TODOs before flashing real hardware
- ✅ **Sleep model decided** — stick with `delay()` → FreeRTOS idle → `__WFE` (~2-5 µA with DCDC). True System OFF rejected because it can't wake from RTC on nRF52840.
- ✅ **DCDC regulator enabled** in `setup()` via `sd_power_dcdc_mode_set`
- ✅ **InternalFS / LittleFS persistence** for `calFactor`, `tareOffset`, `packetId` (saved every 16 cycles to limit flash wear)
- ✅ **Calibration CLI** in `cal_mode.cpp` over USB CDC at 115200 baud
- ✅ **VBUS detect** at boot → enters cal mode if USB plugged in (skips advert loop)
- ⏭️ Hall-sensor cal trigger (needs optional A3144 — deferred)

### Power validation
- ⬜ Once flashed, validate with Nordic PPK II — target <20 µA average

---

## 4. Cloud (`cloud/api/`) — **deployed to staging + production (2026-06-01)**

Lives in the same Cloudflare account as Smart Hive Scale; isolation is by
resource naming (`oa-` prefix) + per-env secrets. See [cloud/api/README.md](../cloud/api/README.md).

Account: `8e7dac970ca4f95a26333c1b17fb290e` (grantjreadings@gmail.com).
Region: WEUR. D1 IDs: staging `f714bc51-dc22-4a76-9128-a81ba86acdd5`, prod `0b326164-7fcc-4328-860c-b5057a5a8f9c`.
Secrets stored locally at `cloud/api/.secrets.local` (gitignored).

### Framework
- ✅ Hono Worker `src/index.ts` with `X-API-Key` (`timingSafeEqual`) auth
- ✅ Endpoints: `POST /v1/readings`, `GET /v1/hives`, `GET /v1/hives/:id/readings`, `PATCH /v1/hives/:id`
- ✅ D1 schema `migrations/0001.sql` with `UNIQUE(hive_id, packet_id, ts)` and `(hive_id, ts)` index
- ✅ `wrangler.toml` with `[env.staging]` (`oa-api-staging` / `oa-staging`, `workers_dev = true` for now) and `[env.production]` (`oa-api-prod` / `oa-prod`, `workers_dev = false`); smart placement + observability on
- ✅ `package.json` scripts: `dev`, `deploy:staging`, `deploy:prod`, `db:migrate:{local,staging,prod}`, `tail:{staging,prod}`
- ✅ `cloud/api/README.md` bootstrap guide

### Bootstrap (done)
- ✅ `npm install` in `cloud/api/` (wrangler bumped to v4)
- ✅ `npx wrangler login` (OAuth)
- ✅ `npx wrangler d1 create oa-staging` + `oa-prod`; IDs pasted into `wrangler.toml`
- ✅ `npm run db:migrate:staging` and `db:migrate:prod`
- ✅ `npx wrangler secret put API_KEY` / `API_KEY_SALT` for both envs
- ✅ `npm run deploy:staging` → smoke-test pass: unauth 401, auth POST/GET round-trip ✓
- ✅ `npm run deploy:prod` (script uploaded; no trigger yet — flip `workers_dev = true` or bind a custom route when needed)
- ⏭️ Custom domain / route binding (e.g. `api.openapiary.dev`) — when domain registered
- ⏭️ Public viewer on Cloudflare Pages — Phase 2

Staging URL: `https://oa-api-staging.grantjreadings.workers.dev`

---

## 5. App (`app/`) — Ionic React + Capacitor

- 🟡 Folder exists with README only (interactive `npm create ionic-app@latest` deferred)
- ⬜ Run `npm create ionic-app@latest app -- --type react --capacitor --name openapiary --no-git`
- ⬜ Add deps: `@capacitor-community/bluetooth-le`, `@capacitor-community/sqlite`, `react-chartjs-2`, `chart.js`, `tailwindcss`
- ⬜ `npx cap add ios` / `npx cap add android`
- ⬜ Copy v4 Tailwind tokens + hex motif into `app/tailwind.config.js`
- ⬜ Port `hive-visual.js` → `<HiveVisual />` React component
- ⬜ Local SQLite schema (`hives`, `readings`) per plan §5.5 — every row starts `synced=0`
- ⬜ BTHome v2 service-data parser (mirror `firmware/src/bthome.h`)
- ⬜ Screens: `HiveListPage`, `HiveDetailPage`, `AddHivePage`, `SettingsPage`, `CalibrationHelperPage`
- ⬜ Foreground BLE scan while a hive screen is open (no background scan in v1)
- ⬜ **Auto-sync** — fire `POST /v1/readings` (a) on app foreground, (b) every 5 min while open, (c) immediately after any new BLE advert is stored. Only flip rows to `synced=1` on confirmed HTTP 200.
- ⬜ **Manual "Sync now"** button (per-hive + global on Settings) for user-triggered flush
- ⬜ **Read-back from cloud**: long-range charts (7d / 30d) `GET /v1/hives/:id/readings` when online; local-cache fallback offline
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
