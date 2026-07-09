# OpenApiary — To-Do Plan

> **Status**: Live working document. Supersedes the original `migration-plan.md`.
> **Last updated**: 2026-07-09 (firmware OTA shipped + hardened end-to-end; flat 1-min cadence; see [firmware-ota.md](firmware-ota.md))
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
- ✅ `src/hx711_helper.h` — custom SoftDevice-safe bit-bang reader (`hx711_raw_read_timeout` with `noInterrupts()` per bit + 500 ms cap), 10-sample median, spread diagnostic, friction-guard re-read, power_down/up
- ✅ `src/persist.h` — InternalFS / LittleFS wrapper, `/cal.txt` plain-text store
- ✅ `src/cal_mode.cpp` — USB-CDC CLI: `tare`, `cal <kg>`, `show`, `save`, `ble [seconds]`, `reboot`, `exit`

### TODOs before flashing real hardware
- ✅ **Sleep model decided** — stick with `delay()` → FreeRTOS idle → `__WFE` (~2-5 µA with DCDC). True System OFF rejected because it can't wake from RTC on nRF52840.
- ✅ **DCDC regulator enabled** in `setup()` via `sd_power_dcdc_mode_set`
- ✅ **InternalFS / LittleFS persistence** for `calFactor`, `tareOffset`, `packetId` (saved every 16 cycles to limit flash wear)
- ✅ **Calibration CLI** in `cal_mode.cpp` over USB CDC at 115200 baud
- ✅ **VBUS detect** at boot → enters cal mode if USB plugged in (skips advert loop)
- ✅ **SoftDevice-safe HX711 driver** — bogde `wait_ready()` hangs because SoftDevice ISRs stretch SCK >60 µs which trips HX711 power-down. Replaced with custom bit-bang + `noInterrupts()` per bit + timeout.
- ✅ **Real battery read** via `analogReference(AR_INTERNAL_3_0)` + 12-bit + discard-first sample + 8-sample average. Divider 1510 kΩ / 510 kΩ; verified on USB at 4.97 V (rail), needs revalidation on battery.
- ✅ **Real die-temp read** via `sd_temp_get(&raw)` (NOT direct `NRF_TEMP` register polling — SoftDevice owns the peripheral and direct access hangs forever).
- ⏭️ Hall-sensor cal trigger (needs optional A3144 — deferred)

### Power validation
- ⬜ Once on battery: validate with Nordic PPK II — target <20 µA average at the new 1-min interval (see §3a). If we miss target, fall back to the SwitchBot-style techniques in §3c.

---

---

## 3a. Wake interval — change from 15 min to time-of-day adaptive

**Decision:** 15 min default is far too coarse. New defaults:

| Time of day | Wake interval | Rationale |
|---|---|---|
| 06:00 – 22:00 (local) | **1 minute** | Active hours: solar is charging, app/HA users expect near-live data |
| 22:00 – 06:00 (local) | **5 minutes** | Night: no solar, nothing useful changes in a hive, conserve battery |

Fallback (no time set): always 1 min. The waste is only 5× during 8 night hours,
which is acceptable until first sync.

### Does the nRF52840 know the time?

The chip has a 32.768 kHz LFCLK driving three RTC peripherals (RTC0/1/2). It can
measure **elapsed time** very accurately (drift ≈ ±50 ppm with the onboard XTAL
— a few seconds per day). It does **not** know wall-clock time at boot — there
is no battery-backed RTC and no GPS.

Wall-clock time has to be **seeded** once after every full power loss. Options
(in order of cost/complexity):

1. **BLE GATT Current Time Service** during pairing in the Ionic app — free,
   ~2 s extra connect time, re-sync opportunistically every time the user
   opens the app and is in range. **Chosen for v1.**
2. **USB CLI command** `time YYYY-MM-DD HH:MM:SS` — already trivial to add in
   `cal_mode.cpp`. Useful as a debug fallback.
3. **External RTC chip** (DS3231 + CR2032 backup) — +£3 BOM, +1 I²C wire, ±2
   ppm. Overkill for a hive scale. Deferred to v2 if drift becomes a problem.

### Sync model

- Phone connects → writes `current_time` characteristic with Unix epoch (UTC).
- Firmware stores it in RAM and snapshots `RTC2->COUNTER` at the same moment.
- On every wake, compute current epoch = `seedEpoch + (RTC2->COUNTER - seedTick) * RTC_PERIOD_SEC`.
- After ~30 days of no sync, drift ≈ ±2 min — still good enough for hourly
  scheduling. Mark the time as "stale" in BTHome status if no sync in 30 days.
- Local timezone offset stored alongside seed (e.g. UTC+1 BST) so the
  06:00–22:00 window matches "daylight" without DST headaches.

### Firmware TODO

- ✅ Replace `WAKE_INTERVAL_MS` constant with `nextWakeIntervalMs()` helper that
  returns 60 000 or 300 000 based on local hour.
- ✅ Add small connectable GATT service exposed only during a short "pairing
  window" (first 60 s after boot, or after a magnet swipe in v1.1):
  - `0x2A2B` Current Time (writable)
  - `0x2BB1` Display Name (custom, writable, max 16 chars; see §3b)
  - On disconnect, drop back to advert-only.
- ✅ Persist `displayName`, `seedEpoch`, `seedTick`, `tzOffsetMinutes` in
  `/cal.txt` (extend the existing OAPersist struct).

---

## 3b. Custom device name from the app

Multiple Open Apiary scales will all show up as `OA-XXXX` in nRF Connect /
Home Assistant — fine for unique IDs, terrible for humans ("is OA-ABCB the
back-garden one or the apiary one?").

**v1 plan:**

- Firmware default: `OA-XXXX` (last 4 hex of MAC). Always available as the
  underlying BLE identity.
- Optional custom name: up to 16 ASCII chars, stored in `/name.txt` via
  InternalFS. If present, used as the BLE local name in scan response
  (`Bluefruit.setName()` is already called every wake cycle — just point it at
  the custom name if set).
- BTHome service-data UUID and the MAC stay the same → Home Assistant
  auto-discovery still works.
- Ionic app exposes a **Rename** action on the hive detail page:
  - Opens a short BLE GATT connection to the scale (during the pairing window
    above)
  - Writes the new name to the `0x2BB1` characteristic
  - Firmware persists it and immediately re-broadcasts with the new local name
  - App also stores the same name locally so the list view is sensible even
    when the scale is asleep

**App TODO** (added to §5):

- ✅ "Rename" button on `HiveDetailPage` → BLE connect → write name characteristic → disconnect → update SQLite row.
- 🟡 Show both the friendly name AND the `OA-XXXX` underneath, so users can still match by MAC if needed. (friendly name shown; underlying ID exposure still needs a dedicated UI line)

---

## 3c. SwitchBot-style ultra-low-power broadcasting — research notes

**Question (from Grant):** how does the SwitchBot Meter (W2201500) get ~1 year
on 2× AAA cells while seeming to broadcast continuously?

**Short answer:** it doesn't really broadcast continuously, and the AAAs do most
of the heavy lifting (≈ 2000 mAh × 2 in series, or ≈ 4× a typical 1000 mAh
LiPo of usable energy at 3V regulated). The techniques are:

1. **Non-connectable, scannable adverts only.** No GATT connection in steady
   state means no LL_CONNECT_REQ handling, no encryption negotiation, no
   subscribed notifications. Average current is dominated by the advert burst.
2. **Single short advert burst at low TX power.** SwitchBot uses ~5 s
   intervals, advert ~1.5 ms across 3 channels at 0 dBm. That's roughly
   `(7.5 mA × 1.5 ms) / 5 s = ~2.3 µA` for radio alone.
3. **Tiny payload.** A handful of bytes (temp i16, hum u8, battery u8). Less
   air time = less mA·ms.
4. **Aggressive deep sleep between adverts.** nRF52 System ON + RAM retention
   + only LFCLK running ≈ 1.5–2 µA. DCDC regulator on.
5. **No sensor work most of the time.** SHT30-class I²C sensor takes ~10 ms
   @ ~1 mA every sample. They sample every advert (cheap). Crucially they
   don't drive a load cell.
6. **Low-leakage support circuitry.** No always-on LED, no pull-ups they don't
   need, MOSFET-gated rails for the sensor.

**Why Open Apiary can't quite match it (and why that's fine):**

- **HX711 read dominates our power budget.** A 10-sample median means HX711
  is powered (~1.5 mA) and the MCU is awake polling DRDY for ~250 ms per
  cycle. That's `(1.5 mA × 0.25 s) / 60 s = ~6 µA` average at a 1-min interval
  for HX711 alone — already 3× SwitchBot's *total* budget.
- **Load cells don't change second-to-second** like temperature or motion, so
  there's no point sampling at SwitchBot rates. The 1-min daytime / 5-min
  night cadence is the right answer.
- **We have solar.** A 1 W panel produces ~50–200 mA in daylight; a single
  good UK day refills a 1000 mAh LiPo many times over. Our real risk is a
  4-week winter overcast spell, not the daily budget.

**Techniques we should still adopt from SwitchBot:**

- ✅ Non-connectable adverts in steady state (we already do this for BTHome).
- ✅ Short advert duration — we use 300 ms; could trim to 150 ms (still hits all 3 channels).
- ✅ 0 dBm TX power (already set).
- ⬜ **Power-gate the HX711 hard** — drive its VCC through a P-MOSFET from a
  GPIO so we cut the ~1.5 mA leakage between samples, not just put it in
  `power_down()`. (~80 % HX711 power saving at 5-min intervals.)
- ⬜ **Skip the 10-sample median at night** — load cells don't drift much at
  3 a.m. A 3-sample median is enough and saves ~70 % of HX711 awake time
  during the 5-min night cycles.
- ⬜ **Disable the on-board user LEDs at the bootloader level** (Adafruit
  Bluefruit core blinks them on advert; saves ~50 µA each).
- ⬜ Consider a smaller (220 ms) advert and skipping the scan response when
  no name change has happened, to halve radio-on time.

**Realistic v1 power target (revised from <20 µA):**

- HX711 power-gated, 1-min day / 5-min night, 150 ms adverts, DCDC, LEDs off:
  **target ~15 µA daytime average, ~5 µA night average**.
- With 1000 mAh LiPo and solar in any UK location except deepest winter: a
  *single overnight* on battery alone is trivial. Two overcast weeks in
  December is the real test.

---

## 4. Cloud (`cloud/api/`) — **deployed to staging + production (2026-06-01)**

> **Update 2026-07-06 — consolidated to production-only on `openapiary.co.uk`.**
> Staging (`oa-api-staging`) has been retired from `wrangler.toml`; everything
> ships live to `oa-api-prod`. The API is served at **`https://api.openapiary.co.uk`**
> (legacy `api.openapiaryproject.com` kept as a temporary fallback), and the admin
> dashboard at **`https://openapiary.co.uk`** (Pages project `oa-fleet`). The app
> pins its API URL to the new domain and cloud sync is on by default. New
> endpoint added: `DELETE /v1/hives/:id/readings` (idempotent; supports `?ts=` for
> selective deletes or all readings when omitted).

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

- ✅ Scaffolded Ionic React + Capacitor (blank starter), appId `uk.co.openapiary.app`
- ✅ Deps installed: `@capacitor-community/bluetooth-le`, `@capacitor-community/sqlite`, `@capacitor/preferences`
- ✅ Android platform added with BLE manifest permissions (`BLUETOOTH_SCAN` neverForLocation, `BLUETOOTH_CONNECT`, legacy fallbacks)
- ✅ BTHome v2 parser (`src/lib/bthome.ts`) mirroring `firmware/src/bthome.h`
- ✅ Cloudflare Worker API client (`src/lib/api.ts`)
- ✅ BLE scanner wrapper (`src/lib/ble.ts`)
- ✅ Settings store using `@capacitor/preferences` (`src/lib/settings.ts`)
- ✅ Screens: `HiveListPage`, `HiveDetailPage`, `AddHivePage` (scan+pair), `SettingsPage`
- ✅ Production build verified
- ✅ Local SQLite schema (`hives`, `readings`) with `synced=0` flag (`src/lib/db.ts`)
- ✅ **Auto-sync** — fires on app boot + every 5 min; per-hive batched POSTs; only marks rows synced on HTTP 200 (`src/lib/sync.ts`)
- ✅ **Manual "Sync now"** button on Settings showing pending count
- ✅ iOS platform scaffolded (Capacitor 8 uses Swift Package Manager — works on Windows; no Mac needed for scaffold, only for local build)
- ⬜ Copy v4 Tailwind tokens + hex motif into `app/tailwind.config.js`
- 🟡 Port `hive-visual.js` → `<HiveVisual />` React component (component exists; full integration/polish pending)
- ✅ Background BLE store-and-forward (Android foreground-service path is implemented; iOS background strategy remains Phase 2)
- ✅ Long-range charts (7d / 30d) — `react-chartjs-2`
- 🟡 **Rename hive on device** — `HiveDetailPage` action BLE-connects during pairing window and writes name characteristic (implemented). Friendly name + `OA-XXXX` dual-label display still pending.
- ✅ **Push current time** to the scale automatically on pairing-window connect, so day/night scheduling (§3a) works without a manual cal-mode `time` command.
- ⏭️ Background scanning, iOS push notifications — Phase 2

### 5.x Distribution plan

- **Android:** debug `.apk` built free by GitHub Actions on every push. Side-load forever, no cost.
- **iOS (now, free):** GitHub Actions builds unsigned simulator `.app` per commit. Anyone with a Mac can run it in the Simulator. No real-iPhone install yet.
- **iOS (target):** $99/yr Apple Developer Program → publish to App Store. Once live, any iPhone user installs from the store with no expiry. Update workflow with signing secrets (`APPLE_CERT_P12_BASE64`, `APPLE_CERT_PASSWORD`, `APPLE_PROVISIONING_PROFILE`, `APPLE_TEAM_ID`) and switch `xcodebuild build` → `xcodebuild archive` + `exportArchive` + `xcrun altool --upload-app` to TestFlight, then promote to App Store after review.

---

## 6. Docs

- ✅ `docs/hardware-build.md` exists (needs photos after build)
- ✅ `docs/home-assistant.md` exists
- ✅ `docs/todo-plan.md` (this file) — single source of truth
- ✅ Remove old `docs/migration-plan.md` and root-level `OpenApiary-migration-plan.md`

---

## 7. CI (`.github/workflows/`)

- ✅ `firmware.yml` — stub: `pio run`, attach `.hex` / `.uf2` on tag
- ✅ `app.yml` — stub: skips if no `package.json` yet
- ✅ `cloud.yml` — stub: deploys only if `CF_API_TOKEN` secret is set

---

## 7a. Firmware OTA (over-the-air updates) — ✅ DONE & field-tested

Full reference: **[firmware-ota.md](firmware-ota.md)**. Summary:

- ✅ Legacy Nordic DFU client (Adafruit bootloader, service `00001530`) in
  `app/src/lib/dfu.ts` — 20-byte packets, PRN=4 backpressure, INVALID_STATE
  self-heal, bootloader resume.
- ✅ Signed release pipeline (Ed25519 over the DFU zip, verified in the Worker;
  app re-checks sha256). Release = `.zip` + `manifest.json` + `.uf2`.
- ✅ Buttonless trigger + retry across wake windows; confirm-after-reboot;
  keep-screen-awake; 3.6 V battery gate.
- ✅ Plain-language Firmware page (instructions first, progress bar, release
  notes, result cards).
- ✅ USB `.uf2` recovery (double-tap reset → drag) as brick-proof fallback.
- ✅ Verified end-to-end over BLE: v1.0.4 → 1.0.5 → 1.0.6 → 1.0.7 → 1.0.8.
- ⏭️ Faster upload (MTU-sized packets) — deferred; unsafe on iOS via ATT MTU,
  needs the real `writeWithoutResponse` limit.

---

## 8. First-Light Checklist (run in order once hardware arrives)

1. ⬜ `pio run -t upload` succeeds with XIAO in DFU mode (double-tap reset)
2. ⬜ nRF Connect on phone sees `OA-XXXX` (or custom name) advertising with service-data UUID `0xFCD2` at the flat 1-minute cadence
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

- Build firmware: `cd firmware; & "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -e xiaoble`
- Flash (XIAO in DFU = double-tap RST, appears as COM7): `pio.exe run -e xiaoble -t upload --upload-port COM7`
- Talk to running firmware (USB CDC, COM8 in app mode): 115200 8N1, commands `tare | cal <kg> | show | save | ble [seconds] | reboot | exit`
- Repo: `https://github.com/greadingsuk/openapiary` (public, PolyForm NC)
- Verified working (2026-06-08): real battery + die-temp + HX711 reads under SoftDevice, BTHome advert decodes correctly in nRF Connect as `OA-ABCB`.
- Next actions:
  1. Implement HX711 hard power-gating + night sample reduction (§3c), then re-run PPK II validation
  2. Finish dual-label hive identity UI (friendly name + `OA-XXXX`) in detail/list surfaces (§3b, §5)
  3. Complete first-light checklist end-to-end on real hardware (§8)
