// Transient-excursion detector for hive inspections.
//
// When a beekeeper opens a hive, lifts the roof, or pulls frames, the scale
// briefly reads a large deviation and then RETURNS to (roughly) the previous
// weight once everything is put back. Those readings are noise for trend
// analysis. In contrast, adding/removing a super or a swarm leaving produces a
// PERSISTENT step that never returns — that's real signal we must keep.
//
// This detector walks the readings in time order, tracking a running baseline.
// A run of readings that deviates by more than `deviationKg` from the baseline
// and comes back within `returnWindowMs` is flagged as a transient excursion.
// Runs that don't return in the window are treated as a genuine level change:
// the baseline is adopted and the readings are kept.
//
// The thresholds are deliberately conservative and app-side tunable (an empty
// poly super + frames is ~1.8-2.1 kg, so a 1.5 kg floor still registers real
// changes while catching inspection wobble). Tweak via the options argument.

export interface ExcursionOptions {
  /** Minimum deviation from baseline (kg) to consider a reading off-baseline. */
  deviationKg?: number;
  /** Max time (ms) within which a deviation must return to count as transient. */
  returnWindowMs?: number;
}

export const DEFAULT_DEVIATION_KG = 1.5;
export const DEFAULT_RETURN_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

interface WeighedReading { ts: number; weight_kg?: number | null }

/**
 * Returns the set of `ts` values that look like transient inspection
 * excursions and should be excluded from charts and statistics. Persistent
 * step changes (supers, swarms) are NOT included.
 *
 * Pass the FULL reading history (not a windowed slice) so the baseline has
 * enough context; the caller can then intersect the result with whatever range
 * it is displaying.
 */
export function detectTransientExcursions(
  readings: WeighedReading[],
  opts: ExcursionOptions = {},
): Set<number> {
  const DEV = opts.deviationKg ?? DEFAULT_DEVIATION_KG;
  const WINDOW = opts.returnWindowMs ?? DEFAULT_RETURN_WINDOW_MS;
  const excluded = new Set<number>();

  const pts = readings
    .filter((r): r is { ts: number; weight_kg: number } => typeof r.weight_kg === 'number')
    .sort((a, b) => a.ts - b.ts);
  if (pts.length < 3) return excluded;

  let baseline = pts[0].weight_kg;
  let i = 1;
  while (i < pts.length) {
    const w = pts[i].weight_kg;
    if (Math.abs(w - baseline) <= DEV) {
      baseline = w; // track gradual drift (nectar gain, evaporation)
      i++;
      continue;
    }
    // A deviation begins at i. Scan forward for a return to baseline within the
    // window. `k` lands on the first reading back within DEV of the baseline.
    let k = i;
    let returned = false;
    while (k < pts.length && pts[k].ts - pts[i].ts <= WINDOW) {
      if (Math.abs(pts[k].weight_kg - baseline) <= DEV) { returned = true; break; }
      k++;
    }
    if (returned) {
      for (let j = i; j < k; j++) excluded.add(pts[j].ts); // transient wobble
      i = k; // baseline unchanged; carry on from the return point
    } else {
      baseline = w; // persistent step (super add/remove, swarm) — keep it
      i++;
    }
  }
  return excluded;
}
