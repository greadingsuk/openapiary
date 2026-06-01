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

## Battery wiring (LiPo)

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
