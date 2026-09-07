# Load Cells — Selection, Matching and Test Procedures

Companion to [hardware-wiring.md](hardware-wiring.md) (how they are wired) and
[hx711.md](hx711.md) (the ADC and firmware read path).

This document covers **which cells to use, how to tell them apart, and how to prove a
set of four is good** before it goes on a hive.

---

## 0. Status — as of 2026-09-07

### Where the test harness stands

Dedicated bench rig: new frame, rigid 3.85 kg chipboard shelf, new HX711, bare XIAO
nRF52840 (no battery, solar or button), calibration factor **-16,489** saved.

| Metric | Value | Verdict |
|---|---|---|
| Corner mean vs true 998 g | 0.976 kg | **−2.2%** |
| Centre vs corner mean | 98.6% | **bridge sums correctly** |
| Worst/best corner | 1.31× | acceptable, was 3.0× |
| Sample spread | 13–16 g | good |
| Static drift, production cadence | ~20 g / 8 min | good |

**This is a working scale.** It was not at the start of 2026-09-07.

### What was actually wrong

In order of impact:

1. **The platform was not delivering its load to the cells.** The old plate weighed >50 g
   and the rig registered 25 g of it. Root cause of the instability that started the
   whole investigation. Fixed by fitting a rigid shelf resting on all four cells.
2. **One dead corner.** Top-right was contributing 40% of what the others did, which
   halved the whole rig's apparent sensitivity. Replacing that cell took centre from 55%
   to 96% of true mass.
3. **The diagnostic tool was manufacturing drift.** See [hx711.md](hx711.md) §3a.
4. Assorted build faults: unsoldered headers, an open `E-` lead, yellows on the wrong
   diagonal, two cells mounted inverted, a floating foot on the main rig.

**Every fault was mechanical or a joint. None were firmware, the MCU or the ADC.**

### Next actions

| Priority | Action |
|---|---|
| 1 | **Recalibrate** with the 1 kg reference weight when it arrives; current factor was set before the TR cell swap and is stale |
| 2 | **Chase the remaining ±13%** — TR reads 114%, BL 87%. Look at mounting before suspecting cells |
| 3 | **Run \u00a74.2 and \u00a74.3 on the main rig** — it has never had a load-path test and shows the same corner signature |
| 4 | **Overnight static run at production cadence** to characterise long-term drift |
| 5 | Firmware Phase 1 — unify the read path ([hx711.md](hx711.md) §7 item 1) |

### Do not re-investigate

Cell sensitivity grades, bridge wiring, radio interference, the ADC, the MCU choice, or
carpet. All refuted with measurements — see §6 and §6a.

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

## 2. The corner-load error — and what it actually is

**Symptom:** the same mass reads differently depending on which corner of the platform
it sits on. Measured at up to **2.02×** between best and worst corner.

This should be impossible. A summing bridge adds the four cells' contributions, so the
output tracks *total force* regardless of where it is applied. Corner and centre must
agree. When they don't, load is either bypassing a cell or reaching it unequally.

### THE CAUSE: a broken load path (confirmed 2026-09-07)

The platform was not delivering its load to the cells.

```
tare, plate ON     -785,996 counts
tare, plate OFF    -785,644 counts
difference             352 counts  =  25 g
```

The plate weighed **well over 50 g**. The cells saw **25 g of it**. The rest was
travelling to the bench through some other contact — frame, bolt head, or the cell body
rather than its free end.

Replacing it with a rigid 3.85 kg chipboard shelf resting on all four cells:

```
first settled reading after lifting the shelf   -3.995 kg
actual shelf weight                              3.85 kg      → +3.8%
```

Load path restored. **This was the root cause of the instability that started the whole
investigation**, and it is the same class of fault as the floating foot found on the main
rig (see §5).

### REFUTED: mixed cell sensitivity

Cells sold as "50 kg half-bridge" do come in different **mV/V** grades (1.0 and 2.0 are
common) and mixing grades in one rig *would* produce a corner-load error. This was the
leading explanation for most of the investigation. **It is wrong here.**

Three independent results killed it:

1. **The substitution test (§4.3).** Two high-reading cells were removed from the bottom
   rail and replaced with two low-reading cells from another rig. The bottom rail still
   read **1.79×** the top rail, against 1.76× before. The effect stayed with the
   *position*, not the cells.
2. **Total sensitivity didn't move.** Before the swap 14,670 counts/kg; after, 14,615.
   A **0.4%** change. Swapping two allegedly-2× cells for 1× cells should have dropped
   centre response by about a third.
3. **Every configuration lands at ~14,000 counts/kg** — 13,953 / 14,670 / 14,615 across
   six different cells in three configurations. Far too consistent for a mixed bag.

Resistance agrees: all four adjacent bridge pairs measured **1.470–1.473 kΩ**, identical
to 0.2% (§4.1). The cells are matched.

> The counts/kg difference against `smart-hive-scale` (26,913) is real but is **not**
> explained. It may be a genuinely different cell type, or a different mechanical
> arrangement. Do not assume a grade difference without evidence.

### Still open: creep

After a 3.85 kg load change the reading drifted **~850 g over 30 s and was still moving**
— roughly 25%, against a real load cell's 0.02–0.05% FS. Static, undisturbed, the same
rig holds **8 g p-p over 86 s**. So drift follows mechanical disturbance only.

Cells sit under large-area 3D-printed caps, so point indentation is unlikely. Cause not
yet identified. See §7.

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

### 4.2 Load-path test — DO THIS FIRST (60 seconds)

Purpose: prove the platform actually delivers its weight to the cells. **This is the
single most valuable test in this document.** It found the root cause on 2026-09-07 and
takes a minute.

1. Weigh the platform on a kitchen scale — call it `W`
2. Remove the platform, `tare`
3. Put the platform back, let it settle, read

**The reading must equal `W`.**

A rig reading 25 g for a plate weighing over 50 g is throwing away most of its load, and
nothing measured afterwards means anything. Do not calibrate, sweep corners, or compare
cells until this passes.

If it fails: the only contact between platform and base should be the four cell load
points. Slide paper underneath — anywhere it won't pass is stealing load. Usual culprits
are bolt heads standing proud, spacers too thin so the platform sits on the cell body
instead of its free end, frame rails touching, or cells bottoming out under load.

### 4.3 Corner-load sweep — acceptance test (5 minutes)

Purpose: prove the assembled rig sums correctly. Run on every rig before service, and
only after §4.2 passes.

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
- centre step ≈ the average of the corners — **this ratio is the health metric.** It must
  be ~100%. Values of 73% / 94% / 118% were measured across three runs on a broken rig
- `spread_g` under ~50 while settled (above that you are still handling it — the reading
  is not valid)
- **run it twice, re-seating in between.** A rig that passes once and fails on repeat is
  not fit for service. Corner steps have been observed changing by **+103%** across
  identical back-to-back runs

**Failure signature:** corners disagreeing with each other and with centre, and not
repeating. That is a broken load path (§4.2), not a cell problem.

**Faster manual alternative (~8 minutes, and it is what actually worked).** Instead of a
timed `monprod` run, drive it by hand — `tare` with the platform empty, then for each
position place the mass, wait ~20 s, and take a single `raw 20`. Read `kg=` off each line.

```
tare
raw 20        <- empty baseline
              place mass on TL, wait 20 s
raw 20
              ... TR, empty, BR, BL, empty, centre, empty
```

- `raw 20` takes ~2 s at 10 SPS, so the duty cycle stays low (see [hx711.md](hx711.md) §3a)
- `spread` on each line tells you immediately whether it had settled — **reject anything
  over ~30 g and re-read**; a 58 g spread on one reading turned into a 15 g spread and a
  27 g different answer on the retake
- Take an empty every 2–3 positions and interpolate the drift out of the steps
- No waiting for segment logic, no fixed timetable, and you can react to a bad reading

### 4.4 Substitution test — position vs cell (≈15 minutes)

Purpose: determine whether a corner-load error follows the **cells** or the **frame**.

You cannot read one cell in a summing bridge, but you can compare by changing one thing
at a time. Two variants, run in this order:

**(a) Swap the cells, keep positions and wiring.** Take the two high-reading cells out
and fit two known-low cells in the same mounts. Re-sweep.

- split follows the new cells → cell sensitivity
- split stays with the position → frame or wiring

**(b) Move cells between mounts, keep every wire on its pad.** Frame and mounts stay put;
only the cells move. Re-sweep and load by *physical* corner.

- high response moves with the cell → wiring / bridge node
- high response stays at the same physical corner → mechanical

> **Trap:** moving a cell between mounts without rotating it 180° in the horizontal plane
> swaps its fixed and load ends, inverting its sense. Two inverted cells cancel two good
> ones and the rig reads a load transient with **no net step**. Observed 2026-09-07.
> All four cells must look identically oriented, mirrored about the centre.

**Result on this project (2026-09-07):** variant (a) gave 1.76× before and 1.79× after —
the effect stayed with the position. Cell sensitivity eliminated. Variant (b) was
attempted but the rig was not repeatable enough for the result to mean anything.

### 4.5 Ranking individual cells (≈1 min per cell)

Only worth doing if §4.4(a) shows the effect really does follow the cells.

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
fit them, then run §4.3 to confirm.

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

### Test harness — 2026-09-07

Dedicated swappable rig: new frame, new HX711, bare XIAO nRF52840 (no battery, solar or
button), four cells from a possibly-mixed pack. Display units unless stated.

**Corner sweeps, original four:**

| Position | Sweep 1 | % of corner mean |
|---|---|---|
| Top-left | 0.379 | 68% |
| Top-right | 0.427 | 77% |
| Bottom-left | 0.657 | 118% |
| Bottom-right | 0.764 | 137% |
| centre | 0.544 | 98% |

Bottom pair / top pair = **1.76×**. Extreme ratio **2.02×**.

**After swapping both bottom cells for known-low cells from the main rig:**

| Position | Before | After |
|---|---|---|
| Top-left | 0.379 | 0.437 |
| Top-right | 0.427 | 0.351 |
| Bottom-right | 0.764 | **0.742** (cells replaced) |
| Bottom-left | 0.657 | **0.672** (cells replaced) |
| bottom/top ratio | **1.76×** | **1.79×** |

Unchanged. Total sensitivity 14,670 → 14,615 counts/kg (0.4%). **Cell sensitivity
eliminated.**

**Repeatability — two identical runs, re-seated between:**

| Position | Run 1 | Run 2 | Change |
|---|---|---|---|
| Top-left | 0.447 | 0.842 | +88% |
| Top-right | 0.452 | 0.919 | +103% |
| Bottom-right | 0.362 | 0.615 | +70% |
| Bottom-left | 0.796 | 0.803 | +1% |
| centre | 0.607 | 0.581 | −4% |
| centre / corner mean | 118% | **73%** | — |

Nothing electrical changed. **The rig was not repeatable**, so no conclusion about cells
or positions was possible from it.

**Bridge resistances at the HX711 (unpowered, chip attached):**

| Pair | kΩ |
|---|---|
| `E+`↔`A+` | 1.473 |
| `E+`↔`A-` | 1.472 |
| `E-`↔`A+` | 1.470 |
| `E-`↔`A-` | 1.472 |
| `E+`↔`E-` | 1.875 |
| `A+`↔`A-` | 1.526 |

All four adjacents identical to **0.2%** → symmetric ring, cells matched, diagonals
correctly assigned (`E+`↔`A-` at 1.472 is well below `E+`↔`E-` at 1.875). Ring sum solves
to 1.961 kΩ; 0.75 × 1.961 = 1.471, matching the adjacents exactly. Both diagonals read
low because the HX711's input impedance shunts those pairs — measure with the chip lifted
if a clean number is needed.

**Load path (the root cause):**

| | counts | → |
|---|---|---|
| tare, old plate ON | -785,996 | |
| tare, old plate OFF | -785,644 | **25 g** registered for a >50 g plate |
| rigid 3.85 kg shelf, first settled reading | | **3.995 kg** — +3.8% |

**Calibration:** `cal 0.998` → factor **-16,489** counts/kg. Cross-check: removing the
998 g weight gave a 960 g step (−3.8%). Consistent to ±4%.

**Creep:** after a 3.85 kg load change, −3.995 → −4.877 kg over 30 s and still moving
(~25%). Static and undisturbed the same rig held **8 g p-p over 86 s**.

**Noise: 2–7 g peak-to-peak** throughout — better than the main rig.

**After replacing the top-right cell** (rigid shelf, calibrated, drift-corrected against
bracketing empty readings, 998 g jar):

| Position | Step | vs true |
|---|---|---|
| Top-left | 0.914 | 92% |
| Top-right | 1.139 | 114% |
| Bottom-right | 0.981 | 98% |
| Bottom-left | 0.870 | 87% |
| **centre** | **0.962** | **96%** |

Corner mean **0.976 kg** against true 0.998 → **−2.2%**. Centre is **98.6%** of the corner
mean. Worst/best corner **1.31×**, down from 3.0×.

The immediately preceding sweep, with the faulty TR cell still fitted, gave:

| Position | Step |
|---|---|
| Top-left | 0.549 |
| **Top-right** | **0.221** |
| Bottom-right | 0.559 |
| Bottom-left | 0.664 |
| centre | 0.550 |

**One bad corner contributing 40% of normal halved the entire rig's sensitivity** — centre
read 55% of the true mass. This is the most important diagnostic lesson of the session:
in a summing bridge a single weak cell degrades *every* reading, not just its own corner.

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
| Mixed cell sensitivity (mV/V grades) | **Refuted** | substitution test §4.4(a); total sensitivity moved 0.4% |
| Unequal cell resistance | **Refuted** | four adjacent pairs identical to 0.2% |
| Yellows on the wrong diagonal | **Was real, now fixed** | `E+`↔`A-` 1.472 < `E+`↔`E-` 1.875 confirms correct |
| Chipboard indenting at contact points | **Refuted** | cells sit under large-area printed caps |

---

## 6a. Corrections and retractions

Recorded because re-deriving a dead hypothesis wastes more time than reading it. Every
one of these was proposed with apparent supporting reasoning and killed by measurement.

| # | Hypothesis | Killed by |
|---|---|---|
| 1 | Unprotected read path corrupted by SoftDevice radio | Radio measurably made readings *quieter* (138 vs 165 counts) |
| 2 | Bad joint in the `A-`↔`E+` arm | Re-measure: 1.472 kΩ vs prediction 1.455 |
| 3 | Wrong bridge node assignment | Topology proven identical to the working sibling rig |
| 4 | Inverted bottom-left cell | All four corners read positive |
| 5 | Carpet causing instability | Rig was *worse* on a hard table |
| 6 | Sibling project used a single-point cell | File search: it is 4× half-bridge |
| 7 | Mixed cell sensitivity grades | The substitution test (§4.4a) |
| 8 | DT shorted to ground | `DT`↔`GND` open |
| 9 | Chipboard indenting under point load | Large-area printed caps already fitted |

**The actual faults, all found by measurement or by the operator:** unsoldered headers,
an open `E-` lead, yellows on the wrong diagonal, two cells mounted inverted, a floating
foot, and — the root cause — a platform that wasn't delivering its load to the cells.

**Every one was mechanical or a joint. None were firmware, the MCU, or the ADC.**

---

## 7. Open questions

- **Creep.** ~25% drift over 30 s after a load change, against 0.02–0.05% FS for a real
  cell. Static drift is nil, so it follows mechanical disturbance. Cause unidentified —
  printed caps deforming, a mount slipping, or the frame relaxing. Needs a long static
  settle test to distinguish bedding-in from something flowing.
- **Repeatability.** Corner steps changing up to +103% across re-seating. Must be solved
  before any cell comparison is meaningful.
- **Why `smart-hive-scale` reads 26,913 counts/kg** against this project's ~14,000–16,500.
  Not explained. Do not assume a cell grade difference — that theory failed here.
- **Why the ESP32 rig achieves corner accuracy and this one doesn't.** Same cell type,
  same wiring topology, same printed caps. The difference is in the mechanical build and
  a direct side-by-side comparison of the two mountings is the fastest way to find it.
- Cell orientation on the main rig was never independently verified.
- The ~2.8% offset between what `cal` computes and what the measurement path reports —
  see [hx711.md](hx711.md), read-path defect. It biases every calibration until fixed.

---

## 8. Standardisation policy

For every rig built, record permanently:

1. **Load-path test result** (§4.2) — platform weight vs registered weight
2. **`E+`↔`E-` resistance** at the HX711
3. **Calibrated counts/kg**
4. **Corner sweep result, run twice with a re-seat between** (§4.3)
5. **Cell batch / order** the four came from

Buy cells **one pack of four, one seller, one order**. Never top up a rig from a
different pack — not because grades differ (that was refuted here) but because it costs
nothing and removes a variable.
