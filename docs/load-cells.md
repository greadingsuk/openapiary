# Load Cells — Selection, Matching and Test Procedures

Companion to [hardware-wiring.md](hardware-wiring.md) (how they are wired) and
[hx711.md](hx711.md) (the ADC and firmware read path).

This document covers **which cells to use, how to tell them apart, and how to prove a
set of four is good** before it goes on a hive.

---

## 1. What the cells are

4× 50 kg half-bridge cells (3 wires each: red, black, yellow), summed into a single
full Wheatstone bridge and read by one HX711.

**Yellow is the centre tap. Red and black are the outer ends.** This is verified — see
§4.1. Do not trust the diagrams that ship with these cells; many show red as the centre
tap, and wiring to that assumption produces a dead scale.

Wiring (identical on both Open Apiary and the smart-hive-scale project):

| Join | Wires |
|---|---|
| Top reds together | TL-RED + TR-RED |
| Bottom reds together | BL-RED + BR-RED |
| Left blacks together | TL-BLACK + BL-BLACK |
| Right blacks together | TR-BLACK + BR-BLACK |

| Yellow | HX711 pad |
|---|---|
| Top-left | `E+` |
| Bottom-right | `E-` |
| Top-right | `A+` |
| Bottom-left | `A-` |

Diagonal pairing on the yellows is critical.

---

## 2. The sensitivity variant problem

**This is the main thing this document exists for.**

Cells sold as "50 kg half-bridge" come in different **sensitivity** ratings, quoted in
**mV/V** (millivolts of output per volt of excitation, at rated load). Common variants
are **1.0 mV/V** and **2.0 mV/V**. They look identical. Nothing on the outside reliably
tells them apart.

Consequences:

- **Mixing variants within one rig** → the four cells contribute unequally to the summed
  bridge → the reading depends on *where* the load sits on the platform. This is the
  corner-load error. It cannot be corrected in software, because a summing bridge has
  only one output.
- **Mixing variants between rigs** → different counts/kg, so calibration factors are not
  transferable and any shared documentation is wrong for one of them.

### Evidence for two variants in use

At HX711 gain 128 on 3.3 V, full scale is about ±12.9 mV → roughly 650,000 counts/mV.
For four summing 50 kg cells (200 kg full scale):

| Cell spec | Predicted counts/kg | Rig | Measured counts/kg |
|---|---|---|---|
| 1.0 mV/V | ~10,700 | Open Apiary | **13,953** |
| 2.0 mV/V | ~21,400 | smart-hive-scale | **26,913** |

Both measurements sit ~28% above the simple prediction — the *same* systematic offset in
both, which is what you expect if the model is sound and only the cell spec differs.
Measured ratio **1.93** against predicted **2.00**.

> **Confidence:** strong but not proven. This is inference from counts/kg, not from a
> datasheet or a direct mV/V measurement. Treat it as the working explanation.

### What this does NOT let you do

You **cannot** determine the absolute mV/V rating of an individual cell from any test in
this document. All the per-cell tests give you is **which cells match each other**.

Label cells as **Group A / Group B**, not as "1.0 mV/V" / "2.0 mV/V" — unless you are
comparing against a set of known provenance, in which case say so explicitly on the
label (e.g. "matches original OA four").

---

## 3. What a multimeter can and cannot tell you

| Question | Multimeter? |
|---|---|
| Is the bridge wired correctly / balanced? | **Yes** — see §4.1 |
| Is a cell open, shorted, or has a bad joint? | **Yes** |
| Which wire is the centre tap? | **Yes** — see §4.1 |
| What is this cell's mV/V rating? | **No, not practically** |
| Do these two cells match? | **No — use §4.3** |

**Why mV/V is not measurable with a handheld meter.** At 3.3 V excitation, a 1.0 mV/V
array produces ~3.3 mV at full scale (200 kg). Put 20 kg on it and you get ~0.33 mV,
versus ~0.66 mV for a 2.0 mV/V array. A 3½-digit meter resolves 0.1 mV on its 200 mV
range — three or four counts, swamped by thermal drift and lead offsets. A 4½-digit bench
meter could just about see it.

**The HX711 resolves microvolts. It is the right instrument, and you already own it.**
Use §4.3.

---

## 4. Test procedures

### 4.1 Resistance fingerprint (unpowered, 2 minutes)

Purpose: confirm wiring, confirm centre tap, detect faults, and provide a batch
fingerprint for standardisation.

**Power off.** A resistance reading taken with the board powered is invalid — the meter
infers R from an injected test current and applied voltage corrupts it.

**Per cell (disconnected):** measure all three pairs — red↔black, red↔yellow,
black↔yellow. The **largest** reading is the two outer ends; the wire not in that pair is
the **centre tap**. The other two readings should each be roughly half the largest.

**Assembled, at the HX711 pads:** the four cells form a ring of eight half-gauges. For a
balanced ring with each half = r:

- `E+`↔`E-` and `A+`↔`A-` ≈ **2r** (equal to each other)
- any adjacent pair (`A+`↔`E+` etc.) ≈ **1.5r**, i.e. **75%** of the above

Open Apiary measured (2026-09-01):

```
E+ ↔ E−   1.87  kΩ      →  2r ≈ 1.94 kΩ, so r ≈ 0.97 kΩ
A+ ↔ A−   2.009 kΩ
A+ ↔ E+   1.40  kΩ      →  predicted 1.5r = 1.455 kΩ
A− ↔ E+   1.472 kΩ         measured mean 1.436 — within 1.3%
```

That fit confirms yellow is the centre tap and the bridge is balanced. **Note this does
not confirm the cells match** — resistance and sensitivity are independent.

Record `E+`↔`E-` and the calibrated counts/kg for every rig. **That pair of numbers is a
batch fingerprint.** Rigs that match are the same variant.

### 4.2 Corner-load sweep — acceptance test (5 minutes)

Purpose: prove an assembled set of four is matched. Run this on every rig before it goes
into service.

Floor on, all four feet seated, rig undisturbed for a minute. Then:

```
tare
monprod 2 240
```

Work through, ~30 s per phase, hands off after each placement:

**empty → TL → empty → TR → empty → BR → empty → BL → empty → centre → empty**

`monprod` closes a `SEGMENT` line at each load change and prints `step=`. Read the
corner deltas straight off the screen.

**Acceptance:**
- all four corner steps within a few percent of each other
- centre step ≈ the average of the corners
- `spread_g` under ~50 while settled (above that you are still handling it — the reading
  is not valid)

**Failure signature (mixed cells):** two corners high, two low, reproducible.

### 4.3 Substitution ranking — sorting a mixed bag (≈1 min per cell)

Purpose: rank individual cells by sensitivity so you can pick a matched four.

You cannot read one cell in a summing bridge, but you can compare cells by changing one
at a time.

1. Nominate one position as the **test socket**. Mark it on the frame.
2. Fill the other three with any three cells — the **reference bed**. These never move
   for the whole exercise.
3. For each candidate cell:

```
tare
monprod 2 60
```

   Wait for the first `SEGMENT` (empty baseline) → place the reference mass **directly
   over the test socket** → hands off → let it settle → send any line to stop.
   Record the `step=` value.

4. Swap the next candidate into the test socket. Repeat.

**Only one variable changes between runs, so the difference in `step=` is that cell's
sensitivity relative to the others.** Quirks in the three reference positions are
constant and cancel.

Notes:
- **No calibration needed.** You are comparing steps, not measuring mass. Skip `cal`.
- Load **over the socket**, not at centre — that maximises the candidate's share of the
  signal and therefore the discrimination.
- **Mark the mass position on the floor plate with tape.** A centimetre of placement
  variation injects noise comparable to what you are measuring.
- **Label every cell 1..N before starting.** Results are unusable otherwise.

**Interpretation:** sort the values. Cells clustering within a few percent are one batch.
A mixed bag should show two clearly separated groups. Take four from the larger cluster,
fit them, then run §4.2 to confirm.

---

## 5. Measured data log

### Open Apiary rig — 2026-09-01

Corner sweep, floor on, jar 0.996 kg, `cal=-6236` (uncalibrated at the time, so figures
are display units — only ratios matter):

| Position | Run 1 | Run 2 |
|---|---|---|
| Top-left | 1.652 | 1.517 |
| Top-right | 1.821 | — |
| Bottom-right | 2.569 | 2.616 |
| Bottom-left | 2.525 | — |
| Centre | 2.049 | 2.178 |

- **Bottom-right responds 1.72× top-left.** Reproducible across two runs and across a
  full unclip-and-reclip of all four cells.
- Two low (top pair), two high (bottom pair) — a clean 2/2 split.
- Centre ≈ mean of corners → the system is **linear**; no friction, binding, or load
  bypassing the cells.

After calibration (`cal 0.996` at centre → factor **-13952.8**):

| Reference | True mass | Reads | Error |
|---|---|---|---|
| Passata jar (small footprint) | 0.996 kg | 0.968 | −2.8% |
| Sugar bag, sealed (spread) | 1.000 kg | 1.121 | +12.1% |

Two near-identical masses **15% apart** purely from how the load is distributed — the
corner error restated.

**Noise once settled: 5 g peak-to-peak, spread 4–12 g.** The sensor is excellent. The
instability that started this investigation was mechanical, not electrical.

---

## 6. Ruled out (do not re-investigate)

| Suspect | Verdict | Evidence |
|---|---|---|
| Radio interference (advertising) | **Not a cause** | 151 counts advertising vs 159–165 radio off |
| Radio interference (live GATT) | **Not a cause** | 138 counts connected — *better* than idle |
| Sampling algorithm / ADC noise | **Not a cause** | 5 g p-p measured |
| Carpet as the foundation | **Not a cause** | rig was *worse* on a hard table; it is back on carpet and stable |
| Bridge wiring topology | **Correct** | resistance fit to 1.3%, and identical to the working sibling rig |
| Bad solder joint in a bridge arm | **Refuted** | re-measure gave 1.472 kΩ vs balanced prediction 1.455 |
| Inverted / reversed cell | **Refuted** | all four corners read positive |
| Floating foot | **Was real, now fixed** | hive floor was contacting only 3 of 4 cells |
| Single-point cell in the sibling project | **Wrong — retracted** | sibling production is 4× half-bridge, same as here |

---

## 7. Open questions

- The corner error is **most likely mixed cell batches** — the leading explanation, not
  proven. §4.3 settles it.
- Cell orientation was never independently verified (all four mounted the same way up).
  Considered unlikely given all corners read positive, but untested.
- The ~2.8% offset between what `cal` computes and what the measurement path reports —
  see [hx711.md](hx711.md), read-path defect. It biases every calibration until fixed.

---

## 8. Standardisation policy

For every rig built, record permanently:

1. **`E+`↔`E-` resistance** at the HX711
2. **Calibrated counts/kg**
3. **Corner sweep result** (§4.2)
4. **Cell batch / order** the four came from

Buy cells **one pack of four, one seller, one order**. Never top up a rig from a
different pack.
