# Firmware over-the-air (OTA) updates

How OpenApiary ships new scale firmware to devices in the field over Bluetooth,
how to cut a release, and how to recover a scale over USB. This is the
authoritative reference — read it before touching the DFU code or the release
pipeline.

---

## 1. Architecture

The scale is a **Seeed XIAO nRF52840** running the **Adafruit nRF52 bootloader**.
That bootloader's BLE DFU is the **legacy Nordic DFU (SDK 11, `dfu_version` 0.5)**
— NOT Nordic Secure DFU. This is the single most important fact: the whole client
must speak the legacy protocol.

```
Phone (Ionic app)                      Cloudflare Worker            GitHub (private release)
  │  GET /v1/firmware/latest  ───────►  proxies + returns  ───────►  reads releases/latest
  │                                     signed manifest
  │  GET /v1/firmware/download ──────►  verifies Ed25519 sig  ─────►  streams the DFU .zip
  │                                     BEFORE streaming bytes
  ▼
  BLE: legacy Nordic DFU to the scale (see §3)
```

- The **app never talks to GitHub**. It only talks to the Worker (`api.openapiary.co.uk`)
  with the shared `X-API-Key`.
- **Authenticity** = a detached **Ed25519 signature** over the DFU `.zip`, verified
  by the Worker against a pinned public key (`FIRMWARE_PUBLIC_KEY`) before it
  streams any bytes. The private key lives offline (`tools/firmware-release/firmware-signing-key.pem`, gitignored).
- **Integrity** = the app re-checks the `.zip` sha256 against the manifest.
- The scale's bootloader **validates the image CRC** (from the init packet) and
  only activates a fully received image, so **a failed update can never brick the
  scale** — worst case it waits in the bootloader.

### BLE UUIDs (legacy Nordic DFU / Adafruit BLEDfu)

| Role | UUID |
|---|---|
| DFU service | `00001530-1212-efde-1523-785feabcd123` |
| DFU control point (write + notify) | `00001531-1212-efde-1523-785feabcd123` |
| DFU packet (write without response) | `00001532-1212-efde-1523-785feabcd123` |

Do **not** use the Secure-DFU UUIDs (`0xFE59` / `8ec9xxxx`) — the device does not
expose them.

---

## 2. The DFU package

`pio run -e xiaoble` produces `.pio/build/xiaoble/firmware.zip`, a legacy DFU
distribution zip containing `firmware.bin`, `firmware.dat` (init packet), and a
`manifest.json` with `dfu_version: 0.5`. That zip is what we sign and publish —
it is already the correct format; only the BLE **client** had to be written to
match it.

---

## 3. The OTA flow (app side)

Implemented in `app/src/lib/ota.ts` (orchestration) and `app/src/lib/dfu.ts`
(BLE legacy DFU client). Surfaced on `app/src/pages/FirmwarePage.tsx`.

1. **Check latest** — `GET /v1/firmware/latest` with `cache: no-store` (the
   endpoint sets a 5-min cache; a version check must be fresh).
2. **Download + verify** the signed `.zip` (Worker verifies signature; app checks
   sha256).
3. **Enter DFU:**
   - If the scale is **already advertising the DFU service** (a previous attempt
     left it in the bootloader), skip straight to the transfer (resume / self-heal).
   - Otherwise catch the scale awake and **buttonless trigger**: connect, enable
     notifications on control `00001531` (the firmware rejects the trigger if
     notifications aren't enabled), write `0x01` (START_DFU). The scale reboots
     into the bootloader.
   - The scale is only connectable for a few seconds each ~60 s wake, so ota.ts
     retries the trigger **across wake windows** for up to 2 minutes.
4. **Transfer (legacy SDK-11 sequence):** START_DFU(app) + image sizes → init
   packet → set packet-receipt notifications → receive image → validate →
   activate & reset.
5. **Confirm-after-reboot:** listen for the scale's advert and verify it is
   actually broadcasting the new version before reporting success.

### Critical transfer details (do not regress)

- **Data packets are 20 bytes.** Do NOT size them from `getMtu()` — iOS reports
  the ATT MTU, but CoreBluetooth silently drops a `writeWithoutResponse` larger
  than its own per-write limit, which stalls the transfer with "DFU control point
  timed out". (Tried 160 B, reverted — see git history / repo memory.)
- **Packet-receipt backpressure = every 4 packets (`PRN_INTERVAL`).** The
  bootloader feeds each packet through a small fixed `hci_mem_pool` RX pool;
  sending faster than it drains flash returns `OPERATION_FAILED`. Waiting for a
  receipt every 4 packets keeps us within the pool.
- Every data packet length must be a **multiple of 4** (the bootloader rejects
  non-word lengths). 20 and the final `total % 20` are both multiples of 4 for a
  word-aligned image.
- **INVALID_STATE self-heal:** a partial transfer leaves the DFU state non-idle,
  so a re-issued START_DFU returns result `2` (INVALID_STATE). On that, we send
  `0x06` (SYS_RESET) to reboot the bootloader clean and tell the user to retry.
- **Battery gate:** the app blocks starting an OTA below **3.6 V** so a
  mid-transfer failure can't strand the scale in the (power-hungry) bootloader
  and drain it flat.

---

## 4. Cutting a firmware release

From the repo root. Requires the offline signing key at
`tools/firmware-release/firmware-signing-key.pem` and the `gh` CLI authed to
`greadingsuk/openapiary`.

```powershell
# 1. Bump the version (single source of truth)
#    Edit firmware/src/version.h -> OA_FW_MAJOR/MINOR/PATCH
#    Keep app/src/lib/ota.ts CURRENT_BUILD in sync.

# 2. Build
cd firmware
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -e xiaoble
cd ..

# 3. Package: DFU zip + UF2 recovery image
$b = "firmware\.pio\build\xiaoble"
Copy-Item "$b\firmware.zip" "tools\firmware-release\openapiary-vX.Y.Z.zip" -Force
$uf2 = "$env:USERPROFILE\.platformio\packages\framework-arduinoadafruitnrf52-seeed\tools\uf2conv\uf2conv.py"
python $uf2 "$b\firmware.hex" -c -f 0xADA52840 -o "tools\firmware-release\openapiary-vX.Y.Z.uf2"

# 4. Sign (produces manifest.json with size, sha256, Ed25519 signature)
cd tools\firmware-release
node sign-release.mjs --version vX.Y.Z --zip openapiary-vX.Y.Z.zip `
     --key firmware-signing-key.pem --notes "What changed" --out manifest.json

# 5. Publish (zip + manifest + uf2 as assets; becomes GitHub 'latest')
gh release create vX.Y.Z --repo greadingsuk/openapiary --title "vX.Y.Z" `
   --notes "Release notes shown in the app" `
   openapiary-vX.Y.Z.zip manifest.json openapiary-vX.Y.Z.uf2
```

The app's Firmware page picks up the new version immediately (cache-busted). The
`.zip`, `.uf2`, `manifest.json` and the signing key are **gitignored** — they live
on the GitHub release, not in the repo.

---

## 5. USB recovery (always works, brick-proof fallback)

If a scale is stuck (e.g. sitting in the bootloader after a failed attempt) or you
want to force a clean image:

1. Plug the XIAO into USB.
2. **Double-tap the reset button** (two quick presses ~0.5 s apart). It mounts as
   a USB drive named **`XIAO-SENSE`** with an `INFO_UF2.TXT`.
   - A **single** reset does NOT do this — a "DFU pending" flag survives a pin
     reset, so a single reset just re-enters the OTA bootloader.
3. Drag `openapiary-vX.Y.Z.uf2` onto that drive. It flashes and reboots
   automatically (the drive ejects when done).
4. **Unplug USB before field use.** The firmware treats a USB *data host* as
   "enter calibration mode", so on a computer it won't run normally — use a
   battery or a dumb charger/power bank. (After a USB flash you may need one reset
   once unplugged to boot into normal mode.)

Alternatively `pio run -e xiaoble -t upload` (double-tap first) flashes over the
serial bootloader.

---

## 6. Version scheme & files to bump

- `firmware/src/version.h` — `OA_FW_MAJOR/MINOR/PATCH` (single source of truth;
  broadcast in the BTHome advert object `0xF2` so the app reads the installed
  version without connecting).
- `app/src/lib/ota.ts` — `CURRENT_BUILD` kept in sync (reference only; the app
  reads the *installed* version from the advert, never from this constant).

---

## 7. Gotchas learned the hard way

- The installed-version display MUST come from the advert / `deviceMeta`, never
  the app's own build number — that produced a false "up to date".
- In the bootloader the scale advertises as **`AdaDFU`** with the `00001530`
  service, NOT BTHome — so the normal scan can't see it; resume detection scans
  for the DFU service.
- Solid **red LED = bootloader/DFU mode** (recoverable), not a fault. The normal
  app firmware has no status LED, so a dark board is usually just asleep.
- iOS caches a peripheral's GATT; force `discoverServices()` before use.
