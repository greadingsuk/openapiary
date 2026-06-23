# Hardware build guide

> Live document. Matches firmware as of 2026-06-08.
> Companion docs: [hardware-wiring.md](hardware-wiring.md) (load cells \u2194 HX711),
> [todo-plan.md](todo-plan.md) (\u00a72 hardware checklist, \u00a73 firmware).

## Bill of materials (v1)

| Item | Qty | Notes |
|---|---|---|
| Seeed XIAO nRF52840 (Standard) | 1 | **NOT** the Sense variant \u2014 IMU not needed, and it's cheaper |
| HX711 load-cell amplifier breakout | 1 | Any cheap green/red board is fine |
| 50 kg half-bridge load cells | 4 | Wired into a full Wheatstone bridge \u2014 see [hardware-wiring.md](hardware-wiring.md) |
| HXT (or equivalent) combinator board | 1 | Bathroom-scale wiring pattern; ~1 \u03a9 across E+/E\u2212, ~2 \u03a9 across A+/A\u2212 |
| 3.7 V 1000 mAh LiPo, JST-PH 1.25 mm | 1 | Must match the XIAO's onboard connector |
| 1 W 5 V solar panel | 1 | Feeds XIAO's USB-C through a Schottky diode |
| A3144 Hall sensor (optional) | 1 | For magnet-triggered calibration mode \u2014 deferred to v1.1 |
| Weatherproof enclosure | 1 | Print or buy; IP65 or better |

## Pinout (XIAO nRF52840 Standard)

| Function | Pin | Net | Notes |
|---|---|---|---|
| HX711 DT (data) | D2 | P0.04 | Input from HX711 |
| HX711 SCK (clock) | D3 | P0.05 | Output to HX711 |
| HX711 VCC | 3V3 | \u2014 | **NOT VBUS** \u2014 3V3 rail from the XIAO regulator |
| HX711 GND | GND | \u2014 | Star ground to LiPo \u2212 |
| Battery sense enable | D6\u2009/\u2009P0.14 | `VBAT_EN` | Drive LOW only while sampling, then HIGH to disable divider |
| Battery sense ADC | `PIN_VBAT` (P0.31) | \u2014 | Provided by Adafruit core; reads divided LiPo voltage |
| LiPo + | BAT JST-PH + | \u2014 | 1S 3.7 V LiPo, 1000 mAh |
| LiPo \u2212 | BAT JST-PH \u2212 | \u2014 | |
| Solar / USB 5 V | USB-C VBUS | \u2014 | Goes through XIAO's onboard charger/regulator |
| Hall (optional) | D6\u2009/\u2009P1.11 | \u2014 | Conflict alert: D6 is currently used by `VBAT_EN` on P0.14; Hall would move to a different pad in v1.1 |

The battery divider on the XIAO Standard is 1510 k\u03a9 / 510 k\u03a9. With the 3.0 V
internal ADC reference and 12-bit resolution:

```
Vbat = adc * (3.0 / 4095) * (1510 + 510) / 510
     = adc * (3.0 / 4095) * (2020 / 510)
```

## Wiring summary

```
            +---------------------+
            |   XIAO nRF52840     |
            |                     |
HX711 DT  --| D2 (P0.04)          |
HX711 SCK --| D3 (P0.05)          |
HX711 VCC --| 3V3                 |
HX711 GND --| GND                 |
            |                     |
VBAT_EN  ---| D6 (P0.14)          |
            |                     |
LiPo      --| BAT JST-PH          |
Solar/USB --| USB-C VBUS          |
            +---------------------+
```

See [hardware-wiring.md](hardware-wiring.md) for the four-load-cell Wheatstone
combinator (E+ / E\u2212 to HX711 RED/BLK, A+ / A\u2212 to HX711 WHT/GRN, diagonal
yellow centre-taps).

## Firmware behaviour at a glance

| Trigger | What happens |
|---|---|
| Boot with USB plugged in (VBUS = 5 V) | Enters **calibration mode** (USB-CDC, 115200 8N1). Stays there until reboot or `exit`. |
| Boot on battery alone | Enters **wake loop**: HX711 read \u2192 battery + temp \u2192 BTHome advert \u2192 sleep until next interval (currently 15 min; moving to 1-min day / 5-min night per [todo-plan.md \u00a73a](todo-plan.md#3a-wake-interval--change-from-15-min-to-time-of-day-adaptive)). |
| Phone scan (nRF Connect / Home Assistant / Open Apiary app) | Sees `OA-XXXX` (last 4 hex of MAC) in scan response; BTHome service-data UUID `0xFCD2` carries weight, voltage, %, temp, charging flag, packet ID. |

## Calibration mode (USB CDC, 115200)

Plug the XIAO into USB \u2192 it enumerates as a serial port (COM8 on Windows when
the app is running; COM7 when in DFU after a double-tap RST). Open any serial
terminal:

```
oa> show
calFactor=-26913.00 tareOffset=0 packetId=42 bootCount=7
oa> tare              # records the current raw reading as zero
oa> cal 5.000         # apply 5.000 kg known weight and run this
oa> save              # persists /cal.txt to InternalFS
oa> ble 10            # broadcast for 10 s without leaving cal mode (debug)
oa> reboot
```

`exit` leaves cal mode and runs the wake loop without rebooting (handy while
the USB cable is still plugged in for debugging).

## BTHome v2 payload (service-data UUID 0x FCD2)

Bytes after the 16-bit UUID (little-endian) carry, in order:

| Object ID | Field | Encoding |
|---|---|---|
| `0x40` | Info / device flags | u8 |
| `0x00` | Packet ID | u8 (wraps every 256 wakes) |
| `0x01` | Battery % | u8 (0\u2013100) |
| `0x02` | Temperature \u00b0C | i16 LE \u00d7 0.01 |
| `0x06` | Weight (kg) | u16 LE \u00d7 0.01 |
| `0x0C` | Voltage | u16 LE \u00d7 0.001 (V) |
| `0x10` | Power state (charging flag) | u8 (0/1) |
| `0x3D` | Counter (boot count low 16) | u16 LE |

The app's `src/lib/bthome.ts` parser is the canonical decoder; Home Assistant
auto-discovers via the BTHome integration with no template needed.

## To document later

- Mechanical layout of the four load cells under the hive baseboard (photos after first build)
- Weatherproofing the HX711 (conformal coat + silicone gland)
- Solar panel mounting angle for UK latitude
- Power Profiler Kit II measurement procedure \u2014 target <15 \u00b5A daytime average after the v1.1 power-gating work in [todo-plan.md \u00a73c](todo-plan.md#3c-switchbot-style-ultra-low-power-broadcasting--research-notes)
- P-MOSFET power-gate for HX711 VCC (\u00a73c) once a candidate part is chosen

