# OpenApiary — v5 Migration Plan

> **Status**: Blueprint, ready to execute in a new isolated workspace.
> **Source project**: Smart Hive Scale v4 (this workspace) — DO NOT modify.
> **Target project**: OpenApiary v5 — new repo at `github.com/greadingsuk/openapiary`.
> **Authored**: 2026-05-27.

---

## 1. Executive Summary

OpenApiary is a clean-room rebuild of the v4 Smart Hive Scale that strips out every enterprise-flavoured dependency (Wi-Fi, Azure, Dataverse, Power Automate, OTA-over-HTTPS, JWT auth) and rebuilds the same end-user value — *know what your hive weighs and how it's trending* — on a fully open-source, free-tier, standards-based stack.

The device becomes a **dumb, autonomous, BLE-broadcasting scale**. The phone becomes a **passive Bluetooth listener** with offline storage and an optional cloud sync. The cloud becomes a **single-file Cloudflare Worker** in front of a **SQLite database (D1)**.

### v4 → v5 contrast

| Axis | v4 Smart Hive Scale | v5 OpenApiary |
|---|---|---|
| MCU | FireBeetle 2 ESP32-E | Seeed XIAO nRF52840 (Standard) |
| Radio | Wi-Fi 2.4 GHz + HTTPS POST | BLE 5.0 advertising only |
| Power source | USB-C 5W solar + 18650 | 1 W 5 V solar + 1000 mAh LiPo via XIAO onboard BQ25101 |
| Sleep current | ~50 mA Wi-Fi off, ~10 µA deep sleep | <10 µA System OFF |
| Wake input | Timer + GPIO button | Timer only (no button, no display) |
| Protocol | Custom JSON over HTTPS | **BTHome v2 unencrypted** (open standard) |
| Cloud | Azure Functions + Table Storage + Dataverse + OpenAI | Cloudflare Worker + D1 (SQLite) |
| Auth | JWT + Logic App + Power Automate write proxy | Single shared API key per app install |
| App | Vanilla JS + Vite (web only) | **Ionic React + Capacitor** (mobile, BLE-capable) |
| OTA | Public GitHub repo + HTTPS download | USB / nRF DFU only (no OTA needed) |
| Licence | Private | **PolyForm Noncommercial 1.0.0, public** |
| Home Assistant | Custom integration required | **Auto-discovered** via BTHome standard |

---

## 2. Workspace Setup

All commands run from PowerShell 7. The new workspace is a **sibling folder** of the existing v4 project so the two never overlap.

```powershell
# 1. Create the new workspace folder (sibling of smart-hive-scale)
cd "C:\Users\greadings\!VS Code\2026 GR Personal Projects"
New-Item -ItemType Directory -Path .\OpenApiary
cd .\OpenApiary

# 2. Create the GitHub repo (public, monorepo) and clone it back into this folder
gh repo create greadingsuk/openapiary `
  --public `
  --description "Open-source BLE beehive scale (XIAO nRF52840 + BTHome) with Capacitor app and Cloudflare backend" `
  --gitignore Node `
  --clone
# Licence: PolyForm Noncommercial 1.0.0 (LICENSE file committed manually —
# gh repo create does not offer a PolyForm template).

# After clone, all subsequent paths are inside .\openapiary\
cd .\openapiary

# 3. Scaffold the monorepo layout
New-Item -ItemType Directory -Path firmware, app, cloud, docs, hardware, .github\workflows | Out-Null

# 4. Drop the migration plan into docs/ so the repo carries its own history
Copy-Item ..\..\OpenApiary-migration-plan.md .\docs\migration-plan.md

# 5. Initialize the firmware (PlatformIO)
cd firmware
pio project init --board seeed_xiao_nrf52840 --ide vscode
# Edit platformio.ini to add Adafruit Bluefruit nRF52 + HX711 libs (see §4)
cd ..

# 6. Initialize the Ionic React app (Capacitor wired by default)
npm create ionic-app@latest app -- --type react --capacitor --name openapiary --no-git
cd app
npm install @capacitor-community/bluetooth-le @capacitor-community/sqlite
npx cap add ios
npx cap add android
cd ..

# 7. Initialize the Cloudflare Worker + D1
npm create cloudflare@latest cloud/api -- --type=hello-world --ts --no-deploy --git=false
cd cloud\api
npx wrangler d1 create openapiary
# Copy the database_id wrangler prints into wrangler.toml under [[d1_databases]]
npx wrangler secret put API_KEY   # paste a freshly generated random string
cd ..\..

# 8. First commit
git add .
git commit -m "Initial scaffold: firmware, app, cloud, docs"
git push -u origin main
```

> **Cost note**: All chosen services have permanent free tiers (Cloudflare Workers 100k req/day, D1 5 GB, GitHub public repo, PlatformIO core). No Azure resources are created. **No cost-approval gate is triggered.**

---

## 3. Code Porting Strategy

### Salvage from v4 — **firmware**

| What | Where in v4 | How it ports to v5 |
|---|---|---|
| HX711 default calibration factor `-26913.0` | `main_v2.cpp` L85-88 | Reuse as the initial NVS default in v5; calibrate per-unit on first deployment |
| `readWeight()` algorithm — 10 samples, compute `weightSpread` (max-min) as a diagnostic | `main_v2.cpp` L200 | Port the *algorithm*, not the code. Pack `Spread` into BTHome packet ID byte (or a custom 0xF0 measurement) |
| Friction detection (re-read if delta > 5 kg from last reading) | `main_v2.cpp` L115 | Port verbatim — same false-positive guard applies |
| Battery voltage averaging (20 ADC samples, divider applied) | `main_v2.cpp` L318 | Port the averaging; **replace pin/divider** for XIAO (see §4) |
| Wake-cause branching pattern | `main_v2.cpp` L1159 | Adapt to nRF52 SoftDevice — only one wake source (timer) in v5, but keep the pattern for future RTC alarms |
| NVS-persisted cal/tare via Preferences | `main_v2.cpp` L85-88 | Replace `Preferences` with Adafruit's `InternalFS` / `Adafruit_LittleFS` on nRF52 |

### Salvage from v4 — **web dashboard → Ionic app**

| What | Where in v4 | How it ports |
|---|---|---|
| Tailwind config + design tokens (colours, spacing, hex motif) | `web-dashboard/tailwind.config.js` | Copy into `app/tailwind.config.js`; Ionic supports Tailwind |
| `hive-visual.js` — hexagonal SVG hive illustration | `web-dashboard/src/components/hive-visual.js` | Convert to a React component `<HiveVisual />` |
| `ui.js` widget patterns (cards, buttons, modals) | `web-dashboard/src/components/ui.js` | Map to Ionic equivalents (`IonCard`, `IonButton`, `IonModal`) — keep the *visual language*, not the DOM code |
| Chart.js telemetry setup from `hive-dashboard.js` | `web-dashboard/src/views/hive-dashboard.js` | Port to `react-chartjs-2`; same dataset shape (`{x: ts, y: weight}`) |
| Inspection form schema (queen, brood, diseases, pests, notes, photos) | `web-dashboard/src/views/inspection-form.js` | Reuse field definitions as a TypeScript type for the local SQLite schema |
| Voice tool schema (`create_inspection`, `add_note`, etc.) | `web-dashboard/voice/tools.json` | Optional future feature — keep schema as-is |

### Discarded entirely (do not port)

- `smart-hive-scale/azure-backend/` — all Azure Functions
- `smart-hive-scale/web-dashboard/server.cjs` — JWT proxy and Express-free Node server
- `smart-hive-scale/web-dashboard/src/api/dataverse.js` — Dataverse fetch layer
- `smart-hive-ota/` — entire OTA repo and pipeline
- All Logic App URLs, function keys, App Registrations, managed identities
- Wi-Fi join code, HTTPS client code, NTP sync, mDNS

### Hardware items reused from the v4 BOM

- 4× 50 kg half-bridge load cells (Wheatstone-bridged into HX711)
- HX711 amplifier breakout
- 1 W 5 V solar panel (existing stock)
- Weatherproof enclosure pattern (steal the existing CAD if printed)

### Hardware items **new**

- Seeed Studio XIAO nRF52840 (Standard, **not** Sense)
- 3.7 V 1000 mAh LiPo with JST-PH 1.25 mm connector
- Hall sensor (optional, for magnet-triggered calibration mode) — e.g. A3144

---

## 4. Firmware Roadmap

### 4.1 PlatformIO configuration

`firmware/platformio.ini`:

```ini
[env:xiao_nrf52840]
platform = nordicnrf52
board = seeed_xiao_nrf52840
framework = arduino
monitor_speed = 115200
lib_deps =
    adafruit/Adafruit nRF52 Arduino Core
    bogde/HX711@^0.7.5
    adafruit/Adafruit LittleFS
    adafruit/InternalFileSytem
build_flags =
    -DCFG_DEBUG=0
    -DCFG_LOGGER=0          ; disable serial logger to cut idle current
```

### 4.2 Pinout

| Function | XIAO pin | Notes |
|---|---|---|
| HX711 DT (data out) | D2 (P0.04) | Pull-up disabled in sleep |
| HX711 SCK (clock / power gate) | D3 (P0.05) | **HIGH ≥ 60 µs → HX711 enters 1 µA sleep**; LOW → wakes, allow ~400 ms first stable read |
| Battery sense enable | P0.14 | Drive LOW to enable the on-board voltage divider |
| Battery sense ADC | P0.31 (`PIN_VBAT`) | Divider ratio 1510k/510k → multiply ADC reading by ~2.96 |
| LiPo charge | USB-C → BQ25101 (automatic) | No firmware involvement; solar feeds VBUS |
| Hall sensor (optional) | D6 (P1.11) | Pulled HIGH; magnet → LOW → enter cal mode |
| Status LED (built-in red) | P0.26 | Use sparingly — each blink ~2 mA |

### 4.3 Wake cycle (every 15 minutes)

```
System OFF (~0.4 µA)
    │   ── RTC compare match (15 min) ──>
    ▼
SoftDevice init, DCDC enable
    │
    ▼
HX711 wake: digitalWrite(SCK, LOW); delay(400);
    │
    ▼
Take 10 samples → median + max-min spread
    │
    ▼
HX711 sleep: digitalWrite(SCK, HIGH); delayMicroseconds(70);
    │
    ▼
Read battery: enable divider, ADC ×20 avg, disable divider
    │
    ▼
Build BTHome v2 service-data payload (see §4.4)
    │
    ▼
Bluefruit.Advertising.start() for 300 ms (3 packets across ch 37/38/39)
    │
    ▼
Bluefruit.Advertising.stop()
    │
    ▼
sd_power_system_off()   ← deepest sleep, only RTC remains
```

### 4.4 BTHome v2 payload (unencrypted)

Reference: <https://bthome.io/format/>

**Service UUID** (advertised in flags + service-data field): `0xFCD2`

**Service data bytes**:

| Offset | Bytes | Meaning |
|---|---|---|
| 0 | `0x40` | BTHome v2 device info: v2, **unencrypted**, no trigger |
| 1–2 | `0x00 0xNN` | Packet ID (uint8) — monotonic counter, used by HA + cloud for dedupe |
| 3–5 | `0x06 0xLL 0xHH` | **Weight** (uint16 LE, factor 0.01 kg) — max 655.35 kg |
| 6–8 | `0x0C 0xLL 0xHH` | **Battery voltage** (uint16 LE, factor 0.001 V) |
| 9–11 (opt) | `0x02 0xLL 0xHH` | **Temperature** (int16 LE, factor 0.01 °C) — only if DS18B20 added later |

**Scan response** (so the device shows a friendly name in nRF Connect and HA):

- Local name: `OA-<last 4 hex of MAC>` (e.g. `OA-BC48`)
- TX power: 0 dBm (default; bump to +4 dBm if range is poor)

> **Important**: BTHome's `0x06` object ID is **mass in kg ×0.01** per the spec. Use this rather than a custom object — it gives free Home Assistant integration.

### 4.5 Calibration mode

- Trigger: hold a magnet near the Hall sensor at boot, **OR** detect USB-VBUS present at boot (`digitalRead(PIN_VBUS)`).
- Behaviour: skip the advert loop; open USB CDC serial at 115200 baud; expose a minimal CLI:
  - `tare` → store current raw reading as offset
  - `cal <known_kg>` → compute and store new calibration factor
  - `show` → dump stored cal/tare/version
  - `reboot` → exit cal mode
- Persistence: Adafruit `InternalFS` writes `cal.txt` to LittleFS partition.

### 4.6 Power budget (theoretical)

| Phase | Duration | Current | Charge (µAs) |
|---|---|---|---|
| System OFF | 900 s | 0.5 µA | 450 |
| Wake + HX711 stabilize | 0.4 s | 4 mA | 1 600 |
| 10 samples | 0.3 s | 5 mA | 1 500 |
| Battery read | 0.05 s | 3 mA | 150 |
| BLE advert burst (3 pkts) | 0.3 s | 8 mA | 2 400 |
| **Cycle total** | ~901 s | — | **~6 100 µAs ≈ 1.7 µAh** |

→ **~6.8 µA average current** → 1000 mAh ÷ 6.8 µA ≈ **17 years** ignoring leakage and solar. In practice expect 3–5 years before the LiPo wears out — solar is purely a bonus.

> Validate with a Nordic Power Profiler Kit II before sealing the enclosure.

---

## 5. App (Capacitor Bridge) Roadmap

### 5.1 Stack

- **Ionic React 7** + Capacitor 6
- `@capacitor-community/bluetooth-le` for passive BLE scan
- `@capacitor-community/sqlite` for offline-first local store
- `react-chartjs-2` + `chart.js` for telemetry charts (port v4's setup)
- Tailwind 3 alongside Ionic CSS variables

### 5.2 Screens

| Screen | Purpose |
|---|---|
| `HiveListPage` | List of paired hives, last seen, current weight, battery icon |
| `HiveDetailPage` | Weight chart (24 h / 7 d / 30 d), battery trend, last reading, raw advert log |
| `AddHivePage` | Scan nearby BTHome adverts, pick one, give it a name, save to local DB |
| `SettingsPage` | Cloudflare sync URL, API key, sync interval, export-as-CSV button |
| `CalibrationHelperPage` | Instructions only — actual cal happens over USB serial; explains magnet-trigger |

### 5.3 BLE flow

```ts
import { BleClient } from '@capacitor-community/bluetooth-le';

const BTHOME_UUID = '0000fcd2-0000-1000-8000-00805f9b34fb';

await BleClient.initialize();
await BleClient.requestLEScan(
  { services: [BTHOME_UUID], allowDuplicates: true },
  (result) => {
    const sd = result.serviceData?.[BTHOME_UUID];
    if (!sd) return;
    const reading = parseBTHome(sd);                // returns {packetId, weightKg, batteryV, tempC?}
    if (knownHives.has(result.device.deviceId)) {
      storeReading(result.device.deviceId, reading); // INSERT OR IGNORE on (hiveId, packetId)
    }
  }
);
```

Run the scan in a foreground service while the user is on a hive screen; persist to SQLite immediately. No background scanning in v1 (avoids iOS/Android battery permissions).

### 5.4 Sync flow

- Manual "Sync now" button on each hive **and** a global "Sync all unsynced" on Settings.
- Sends batches of up to 500 unsynced rows: `POST /v1/readings` with `X-API-Key` header.
- On 200, mark rows `synced=1`. On 401, prompt user to re-enter key. On network error, retry with exponential back-off up to 3 times then surface a banner.

### 5.5 Local schema (Capacitor SQLite)

```sql
CREATE TABLE hives (
  id              TEXT PRIMARY KEY,        -- BLE device id (MAC on Android, UUID on iOS)
  name            TEXT NOT NULL,
  added_at        INTEGER NOT NULL,
  cloud_hive_id   TEXT                     -- maps to cloud `hives.id` after first sync
);
CREATE TABLE readings (
  hive_id     TEXT NOT NULL,
  packet_id   INTEGER NOT NULL,
  ts          INTEGER NOT NULL,            -- unix ms when phone received it
  weight_kg   REAL NOT NULL,
  battery_v   REAL NOT NULL,
  temp_c      REAL,
  rssi        INTEGER,
  synced      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hive_id, packet_id, ts)
);
CREATE INDEX idx_readings_unsynced ON readings(synced) WHERE synced = 0;
```

---

## 6. Cloud Backend Blueprint (Cloudflare)

### 6.1 Layout

```
cloud/api/
├── src/index.ts          # Worker entry — Hono framework recommended
├── migrations/0001.sql   # D1 schema
├── wrangler.toml
└── package.json
```

### 6.2 Endpoints

| Method + path | Auth | Body / query | Behaviour |
|---|---|---|---|
| `POST /v1/readings` | `X-API-Key` header (HMAC-compared) | `{hiveId, deviceName, readings: [{ts, weightKg, batteryV, tempC?, packetId, rssi?}]}` | Upserts hive row if missing; bulk-inserts readings with `INSERT OR IGNORE` on the unique constraint |
| `GET /v1/hives/:id/readings?from=&to=` | Optional API key; required if hive `public=0` | from/to as unix ms | Returns array of readings ordered by `ts ASC` |
| `GET /v1/hives` | API key required | — | Lists hives owned by this key |
| `PATCH /v1/hives/:id` | API key required | `{name?, public?}` | Update friendly name / public flag |

### 6.3 D1 schema (`migrations/0001.sql`)

```sql
CREATE TABLE hives (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  owner_key_id TEXT NOT NULL,                -- which API key owns it
  created_at   INTEGER NOT NULL,
  public       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE readings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  hive_id    TEXT NOT NULL REFERENCES hives(id) ON DELETE CASCADE,
  ts         INTEGER NOT NULL,
  weight_kg  REAL NOT NULL,
  battery_v  REAL NOT NULL,
  temp_c     REAL,
  rssi       INTEGER,
  packet_id  INTEGER NOT NULL,
  UNIQUE (hive_id, packet_id, ts)
);
CREATE INDEX idx_readings_hive_ts ON readings(hive_id, ts);
```

### 6.4 Secrets

```powershell
cd cloud\api
npx wrangler secret put API_KEY        # raw key for the first app install
npx wrangler secret put API_KEY_SALT   # used to derive HMAC for header comparison
```

> v1 ships with a single shared key per install. Multi-user / per-key ownership is a Phase-2 upgrade — add a `keys` table and JWT later if needed.

### 6.5 Optional public viewer (Phase 2)

A Cloudflare Pages site that consumes the same Worker. Reuse the v4 dashboard's Chart.js setup; render any hive where `public=1`. Zero new infrastructure.

---

## 7. Repository Structure & GitHub Setup

```
openapiary/
├── README.md                 # quickstart, what it is, link to bthome.io
├── LICENSE                   # PolyForm Noncommercial 1.0.0
├── CONTRIBUTING.md           # how to flash, how to PR, code of conduct link
├── docs/
│   ├── migration-plan.md     # this file
│   ├── hardware-build.md     # wiring, BOM, enclosure
│   └── home-assistant.md     # how HA auto-discovers BTHome devices
├── firmware/
│   ├── platformio.ini
│   └── src/
│       ├── main.cpp
│       ├── hx711_helper.h
│       ├── bthome.h          # payload builder
│       └── cal_mode.cpp
├── app/                      # Ionic React + Capacitor (npm workspace)
├── cloud/api/                # Wrangler project
├── hardware/                 # KiCad / Fusion files, BOM.csv
└── .github/workflows/
    ├── firmware.yml
    ├── app.yml
    └── cloud.yml
```

### GitHub Actions

**`firmware.yml`** — on push or tag, run `pio run`, attach `firmware.hex` and `firmware.uf2` to a GitHub Release.

**`app.yml`** — on push, `npm ci && npm run build` to verify the web bundle. Native builds (iOS `.ipa`, Android `.apk`) stay local for v1.

**`cloud.yml`** — on push to `main`, `wrangler deploy` using `CF_API_TOKEN` and `CF_ACCOUNT_ID` repo secrets.

---

## 8. Verification & First-Light Checklist

Run these in order. Each step must pass before moving to the next.

1. **Firmware flashes**: `pio run -t upload` succeeds with the XIAO in DFU mode (double-tap reset).
2. **Advert visible**: open nRF Connect on a phone, see `OA-XXXX` advertising every ~15 min with service-data UUID `0xFCD2`.
3. **BTHome decoded**: nRF Connect shows weight/battery in human-readable form (BTHome decoder built in). If using Home Assistant, the device auto-appears under Settings → Devices.
4. **Calibration works**: with USB plugged in, open serial monitor, type `tare` then place 5 kg known weight and type `cal 5`. Read back `show` to verify factor stored.
5. **App discovers**: open the Ionic app on a real device (not browser — Web Bluetooth doesn't decode service data the same way), hit "Add hive", see the advert appear, name it, save.
6. **Local storage**: leave the app open for one wake cycle (~15 min). Verify a row appears in the hive detail chart.
7. **Cloud sync**: hit "Sync now". `wrangler tail` shows a `POST /v1/readings` with 200. `npx wrangler d1 execute openapiary --command "SELECT * FROM readings ORDER BY ts DESC LIMIT 5;"` shows the row.
8. **Power budget**: connect a Power Profiler Kit II between LiPo and XIAO. Confirm average current < 20 µA across at least 3 cycles.

---

## 9. Open Questions / Further Considerations

These are decisions to revisit *after* first light — none of them block scaffolding.

1. **App framework** — Recommend Ionic React. Alternatives: Ionic Vue (smaller bundle), Ionic Angular, or pure PWA + Web Bluetooth (rejected — iOS Safari has no Web BT).
2. **BTHome encryption** — Start unencrypted for OSS friendliness and HA auto-discovery. Upgrade to AES-CCM with a per-device key only if hive privacy becomes a concern.
3. **Cloud auth** — Single shared API key in v1. Upgrade paths: Cloudflare Access (zero-trust), per-user JWT, or anonymous public hives only.
4. **Repo visibility** — Assumed public for the open-source pitch. Confirm before running `gh repo create`.
5. **Power validation** — The 6.8 µA average is theoretical. Instrument with Nordic PPK II before sealing the enclosure.
6. **Multi-hive scaling** — At ~96 readings/day per hive, D1's 5 GB free tier holds ~10 million readings ≈ ~280 hive-years. No scaling concerns.
7. **Phase 2 features** — DS18B20 temperature, public Cloudflare Pages viewer, Home Assistant blueprint, voice notes (port the v4 voice copilot schema).
8. **Capacitor SQLite vs IndexedDB** — SQLite recommended for offline robustness and easy CSV export. IndexedDB would let the app also run as a pure PWA but loses BTHome decoding on iOS.
9. **Naming** — `OA-XXXX` is fine for now. If the project gains users, consider a `OpenApiary-XXXX` long name in scan response to aid discovery.

---

**End of plan.** Next action: run §2 commands in PowerShell, then execute §4–§6 in order.
