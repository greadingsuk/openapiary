# Hardware Wiring — Hive Scale

Last verified: 2026-06-01 against working personal hive-scale build (same HXT board + same cells).

## Bill of materials

- 4× 50 kg half-bridge load cell (3-wire: RED, BLACK, YELLOW). Yellow is the center tap.
- 1× HX711 "HXT" combinator/amp board (the green one with `E+`, `E-`, `A+`, `A-` pads on one side and DT/SCK/VCC/GND on the other).
- 1× Seeed XIAO nRF52840 (Standard, not Sense).
- Platform: two boards in an "H" so each cell sits at a corner.

## Load-cell combinator — "bathroom-scale" full Wheatstone

This wires the four half-bridge cells as the **four arms of one Wheatstone bridge**.
Each cell becomes one arm; the YELLOW center taps become the bridge nodes that
the HX711 amplifies.

### RED wires — horizontal loops

- **Top-Left RED**   + **Top-Right RED**     → tied together (no other connection)
- **Bottom-Left RED** + **Bottom-Right RED** → tied together (no other connection)

### BLACK wires — vertical loops

- **Top-Left BLACK**    + **Bottom-Left BLACK**  → tied together (no other connection)
- **Top-Right BLACK**   + **Bottom-Right BLACK** → tied together (no other connection)

### YELLOW wires — to the HX711

These are the only wires that connect to the HXT board. Diagonal pairing is critical.

| Cell             | HXT pad |
|------------------|---------|
| Top-Left YELLOW  | `E+`    |
| Bottom-Right YELLOW | `E-` |
| Bottom-Left YELLOW  | `A-` |
| Top-Right YELLOW    | `A+` |

Diagonals (`TL`+`BR`) carry excitation; the other diagonal (`BL`+`TR`) carries
the signal. The cells must be physically arranged so the labels match the
corners — i.e. "Top-Left" means the cell at the front-left corner when facing
the hive.

## HX711 → XIAO nRF52840

| HX711 pad | XIAO pin       | Notes |
|-----------|----------------|-------|
| `VCC`     | `3V3`          | HX711 ratings allow 2.7–5 V; XIAO 3V3 rail is fine and quieter than VBUS. |
| `GND`     | `GND`          | |
| `DT`      | `D2`           | Data — defined in firmware as `PIN_HX711_DT`. |
| `SCK`     | `D3`           | Clock — `PIN_HX711_SCK`. Driven low between reads to put the HX711 in 1 µA sleep. |

## Battery, switch and solar (v1 field build)

This is the topology used for the first field unit. Everything is soldered
directly to the XIAO; no breakout PCB.

### Parts

- 1× 3.7 V LiPo, **603048**, ~1000 mAh, bare leads (no JST)
- 1× 5 V / 1 W monocrystalline solar panel (~110 × 60 mm, Voc ~5.5 V, Isc ~200 mA)
- 1× 2-terminal rocker switch (SPST) — **NOTE: cuts battery line only** (see rationale below)

### Topology

```
   Solar +  ─────────────────────► XIAO VBUS pad
   Solar −  ─────────────────────► XIAO GND  pad

   LiPo  +  ──[ ROCKER SW ]──────► XIAO BAT  pad
   LiPo  −  ─────────────────────► XIAO GND  pad
```

### Why this works

The XIAO nRF52840 has an on-board LiPo charger (BQ25101) wired between VBUS
and the BAT pad. Apply 5 V to VBUS and it charges the cell at up to ~100 mA —
a good match for a 1 W panel that peaks around 200 mA in direct sun.

- The charger blocks reverse current from BAT to VBUS, so no Schottky diode
  is needed in the solar line.
- Solar is **always connected to VBUS** so the battery charges whenever the panel
  delivers, independent of the ON/OFF switch.
- When the panel is in shade/night, VBUS floats and the chip runs from BAT as
  normal. Firmware's `vbusPresent()` reads `false` in that state and the
  charging-state telemetry field reports `0`.
- When the panel is delivering, `vbusPresent()` reads `true` and the firmware
  broadcasts charging = 1 — useful for spotting cloudy days in the data.

### Switch placement (battery line only)

The rocker goes on the **battery + line** (between LiPo + and the BAT pad).

- **OFF + dark** → unit fully off, zero current draw. Safe for storage/transit.
  Battery is isolated but NOT discharged; stays at rest voltage.
- **OFF + sun** → **battery charges from solar via VBUS, but device does NOT run**
  (BAT pad is isolated). Charger is active; battery voltage increases over time.
  Useful for remote charging without powering the device.
- **ON** → normal operation. Device runs, solar tops up the cell during the day.

This topology gives you:
- ✅ Battery isolation (switch controls device power)
- ✅ Charging while off (solar always charges via VBUS)
- ✅ Safe storage (zero device drain when switch is off)

### Historical note: Why NOT double-pole?

A double-pole (DPST) switch that cuts both solar + and battery + would achieve
true zero-current sleep, but it would **prevent battery charging while off**.
The single-pole design prioritizes charging during dormancy, which is more useful
for a remote hive scale that may sit unused for weeks but still needs to maintain
battery health. If you later want true offline storage (no charging), add a
separate battery disconnect in series.

### Soldering order (recommended)

1. **Tin all four XIAO pads first** (VBUS, GND × 2, BAT) with a tiny dab of
   solder. Easier to land wires later.
2. Strip and tin **all wire ends** (solar +/−, battery +/−, both switch tails).
3. Solar panel:
   - Solar `+` → XIAO VBUS
   - Solar `−` → XIAO GND
4. Battery:
   - LiPo `−` → XIAO GND (the other GND pad, not the one used for solar — gives
     you mechanical room)
   - LiPo `+` → one terminal of the rocker switch
   - Other rocker terminal → XIAO BAT pad
5. **Strain relief**: put a dab of hot-glue over each XIAO pad joint once tested.
   The pads are pull-up-and-rip if a wire is yanked.

### First power-on test (before installing in a hive)

1. **Switch OFF**, no solar light, no USB. Multimeter on continuity between
   battery + and BAT pad: should be **open** (switch off).
2. **Switch ON**, multimeter same place: should be **closed** (~0 Ω).
3. **Switch ON**, no solar, USB unplugged. Touch a multimeter across BAT and
   GND: should read battery voltage (~3.7–4.2 V). Chip should boot and start
   advertising; check with `nRF Connect` app or your OpenApiary app.
4. Shine a torch / put in sun. Re-read serial via USB later — `charging` field
   in BTHome advert should flip to 1.
5. Leave it on the bench under window light for an hour. Battery voltage at
   the BAT pad should creep up.

### Safe-handling reminders

- LiPo polarity matters. Reversing the cell can damage the BQ25101 charger
  and brick the XIAO. **Double-check + and −** with a multimeter before
  applying the switch.
- Don't let the LiPo dangle by its leads — tape or hot-glue it to the inside
  of the enclosure wall.
- The 603048 cell is unprotected (no PCM); if you discharge it below ~3.0 V it
  will degrade rapidly. Firmware reports battery % via BTHome ID `0x01`; pull
  the unit when the dashboard shows < 10 %.

## Battery wiring (LiPo) — legacy JST notes

- LiPo `+` → XIAO `BAT` pad
- LiPo `−` → XIAO `GND` pad
- Battery voltage is measured via the built-in divider:
  `PIN_VBAT_EN` (GPIO P0.14) is pulled LOW only during sampling, then released
  to save the divider current. Formula in firmware: `adc * (3.0 / 4095) * (2020 / 510)`.

## Sanity checks before powering on

### 1. Per-cell resistance (cells disconnected from HXT)

For each cell, with a multimeter on resistance mode:

- `R–B` (red to black) ≈ **2 Ω** (sometimes 1 kΩ on higher-rated cells; 50 kg cheap cells are ~1–2 Ω)
- `R–Y` (red to yellow) ≈ **half of R–B** — i.e. ~1 Ω
- `Y–B` (yellow to black) ≈ **half of R–B** — i.e. ~1 Ω

Both halves must be equal within a few percent. If one half is much higher,
the cell is damaged.

### 2. After combinator wiring (still no power)

Probe at the HXT pads:

- `E+` to `E-` should read **~1 Ω** (two cells in series, in parallel with two more in series → R/2 + R/2 in parallel with R/2 + R/2 = R/2; with R ≈ 2 Ω → 1 Ω).
- `A+` to `A-` should read **~2 Ω** (the signal diagonal, slightly different topology).

These match the values measured on the personal hive scale build, so good
enough as a known-good reference.

### 3. After powering up, before calibrating

Plug USB into the XIAO. Firmware detects VBUS and drops straight into calibration
mode (no BLE advert loop). Open the serial port at **115200 baud** and run:

```
show
```

You should see a raw HX711 value that:
- changes when you press lightly on the platform
- changes in **roughly the same magnitude** when you press each of the four
  corners (not 10× bigger on one corner than another — that would indicate a
  wiring fault on a cell or a damaged cell)

### 4. Calibration

With the empty platform sitting flat:

```
tare
```

Then place a known weight on the centre (e.g. a 5 L water bottle = ~5 kg):

```
cal 5.0
```

The firmware computes `calFactor = (raw - tareOffset) / knownKg` and saves it
to `/cal.txt` in LittleFS. Verify with `show` — the `kg` field should now
match the known weight within ±20 g.

To finish:

```
reboot
```

The firmware reboots, detects no VBUS, and enters the normal 15-minute
BLE advert cycle.
