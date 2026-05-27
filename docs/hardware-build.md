# Hardware build guide

> Stub — to be expanded once the v1 prototype is assembled.

See [`migration-plan.md` §4.2](migration-plan.md) for the canonical pinout and
[`migration-plan.md` §3](migration-plan.md) for the parts list.

## Bill of materials (v1)

| Item | Qty | Notes |
|---|---|---|
| Seeed XIAO nRF52840 (Standard) | 1 | **NOT** the Sense variant — IMU not needed |
| HX711 load-cell amplifier breakout | 1 | Any cheap green/red board is fine |
| 50 kg half-bridge load cells | 4 | Wired into a full Wheatstone bridge |
| 3.7 V 1000 mAh LiPo, JST-PH 1.25 mm | 1 | Must match the XIAO's onboard connector |
| 1 W 5 V solar panel | 1 | Feeds XIAO's USB-C through a Schottky diode |
| A3144 Hall sensor (optional) | 1 | For magnet-triggered calibration mode |
| Weatherproof enclosure | 1 | Print or buy; IP65 or better |

## Wiring summary

```
            +---------------------+
            |   XIAO nRF52840     |
            |                     |
HX711 DT  --| D2 (P0.04)          |
HX711 SCK --| D3 (P0.05)          |
Hall      --| D6 (P1.11)  (opt)   |
            |                     |
LiPo      --| BAT JST-PH          |
Solar     --| USB-C VBUS          |
            +---------------------+
```

## To document later

- Mechanical layout of the four load cells under the hive baseboard
- Weatherproofing the HX711 (conformal coat + silicone gland)
- Solar panel mounting angle for UK latitude
- Power Profiler Kit II measurement procedure
