#!/usr/bin/env python3
"""Analyse HX711 bench captures from the calibration-mode CLI.

Handles three capture formats:
  mon      t_s,raw,net,kg,tempC,spread_g,battV
  monprod  t_s,kg,spread_g,tempC,battV,conn
  dump     i,raw            (preceded by a '# path=... tare=... cal=...' line)

Usage:
  python analyse.py capture.csv                  # summarise one capture
  python analyse.py a.csv b.csv --compare        # side-by-side comparison
  python analyse.py dump-safe.csv --estimators   # median vs trimmed mean vs mean

Stdlib only. Grams are the working unit throughout; the calibration factor is
read from the dump preamble or supplied with --cal.
"""

from __future__ import annotations

import argparse
import csv
import math
import statistics
import sys
from pathlib import Path

# Counts-per-kg fallback when a capture carries no calibration preamble.
DEFAULT_CAL_FACTOR = -26913.0


class Capture:
    def __init__(self, path: Path):
        self.path = path
        self.kind = ""
        self.meta: dict[str, str] = {}
        self.rows: list[dict[str, float]] = []
        self._load()

    def _load(self) -> None:
        lines = self.path.read_text(encoding="utf-8", errors="replace").splitlines()
        data_lines = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            if line.startswith("#"):
                for token in line.lstrip("# ").split():
                    if "=" in token:
                        k, v = token.split("=", 1)
                        self.meta[k] = v
                continue
            # Drop CLI chatter such as prompts and "mon done".
            if "," not in line or line.startswith("oa>"):
                continue
            data_lines.append(line)

        if not data_lines:
            raise SystemExit(f"{self.path}: no CSV rows found")

        header = data_lines[0].split(",")
        if header[0] not in ("t_s", "i"):
            raise SystemExit(f"{self.path}: unrecognised header {data_lines[0]!r}")

        self.kind = {"i": "dump", "t_s": "mon" if "raw" in header else "monprod"}[header[0]]

        reader = csv.DictReader(data_lines)
        for row in reader:
            parsed: dict[str, float] = {}
            for key, value in row.items():
                if key is None or value is None:
                    continue
                try:
                    parsed[key] = float(value)
                except ValueError:
                    pass  # trailing "mon done" and similar
            if parsed:
                self.rows.append(parsed)

    @property
    def cal_factor(self) -> float:
        return float(self.meta.get("cal", DEFAULT_CAL_FACTOR))

    @property
    def tare(self) -> float:
        return float(self.meta.get("tare", 0.0))

    def series(self, column: str) -> list[float]:
        return [r[column] for r in self.rows if column in r]

    def grams(self) -> list[float]:
        """The weight series in grams, whatever the capture format."""
        if self.kind == "dump":
            return [(c - self.tare) / self.cal_factor * 1000.0 for c in self.series("raw")]
        return [v * 1000.0 for v in self.series("kg")]


def describe(values: list[float]) -> dict[str, float]:
    if not values:
        return {}
    out = {
        "n": len(values),
        "mean": statistics.fmean(values),
        "median": statistics.median(values),
        "min": min(values),
        "max": max(values),
        "p2p": max(values) - min(values),
        "sd": statistics.stdev(values) if len(values) > 1 else 0.0,
    }
    out["p2p_sd"] = out["p2p"] / out["sd"] if out["sd"] else 0.0
    return out


def drift(times: list[float], values: list[float]) -> tuple[float, float]:
    """Least-squares slope in units/hour, plus total excursion."""
    if len(times) < 2 or len(times) != len(values):
        return 0.0, 0.0
    mt, mv = statistics.fmean(times), statistics.fmean(values)
    num = sum((t - mt) * (v - mv) for t, v in zip(times, values))
    den = sum((t - mt) ** 2 for t in times)
    slope = (num / den * 3600.0) if den else 0.0
    return slope, max(values) - min(values)


def correlate(xs: list[float], ys: list[float]) -> tuple[float, float]:
    """Pearson r and least-squares slope of ys against xs."""
    n = min(len(xs), len(ys))
    if n < 3:
        return 0.0, 0.0
    xs, ys = xs[:n], ys[:n]
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx == 0 or syy == 0:
        return 0.0, 0.0
    return sxy / math.sqrt(sxx * syy), sxy / sxx


def sparkline(values: list[float], width: int = 60) -> str:
    if len(values) < 2:
        return ""
    blocks = "▁▂▃▄▅▆▇█"
    step = max(1, len(values) // width)
    sampled = values[::step][:width]
    lo, hi = min(sampled), max(sampled)
    if hi == lo:
        return blocks[0] * len(sampled)
    return "".join(blocks[min(7, int((v - lo) / (hi - lo) * 7.999))] for v in sampled)


def summarise(cap: Capture) -> None:
    g = cap.grams()
    stats = describe(g)
    print(f"\n=== {cap.path.name}  [{cap.kind}]  n={stats['n']} ===")
    if cap.meta:
        print("    " + "  ".join(f"{k}={v}" for k, v in cap.meta.items()))

    print(f"    weight   mean {stats['mean']:11.1f} g   sd {stats['sd']:8.1f} g"
          f"   p2p {stats['p2p']:9.1f} g")

    if cap.kind != "dump":
        t = cap.series("t_s")
        slope, excursion = drift(t, g)
        span_h = (t[-1] - t[0]) / 3600.0 if len(t) > 1 else 0.0
        print(f"    drift    {slope:+11.1f} g/h over {span_h:.2f} h"
              f"        excursion {excursion:9.1f} g")

        spread = cap.series("spread_g")
        if spread:
            s = describe(spread)
            print(f"    spread   mean {s['mean']:11.1f} g   max {s['max']:8.1f} g")

        temp = cap.series("tempC")
        if temp and len(set(temp)) > 2:
            r, k = correlate(temp, g)
            print(f"    vs temp  r={r:+.3f}   {k:+.1f} g/degC"
                  f"   (range {min(temp):.1f}-{max(temp):.1f} C)")

        conn = cap.series("conn")
        if conn:
            linked = [v for c, v in zip(conn, g) if c > 0.5]
            idle = [v for c, v in zip(conn, g) if c <= 0.5]
            if linked and idle and len(linked) > 1 and len(idle) > 1:
                print(f"    radio    connected sd {statistics.stdev(linked):8.1f} g"
                      f"   idle sd {statistics.stdev(idle):8.1f} g")
    print(f"    trace    {sparkline(g)}")


def estimators(cap: Capture, burst: int = 10) -> None:
    """Replay a dump capture through each candidate estimator."""
    if cap.kind != "dump":
        raise SystemExit("--estimators needs a `dump` capture")
    counts = cap.series("raw")
    if len(counts) < burst:
        raise SystemExit(f"need at least {burst} samples, got {len(counts)}")

    def trimmed(vals: list[float], trim: int) -> float:
        s = sorted(vals)
        kept = s[trim:len(s) - trim] or s
        return statistics.fmean(kept)

    bursts = [counts[i:i + burst] for i in range(0, len(counts) - burst + 1, burst)]
    candidates = {
        "median          ": lambda v: statistics.median(v),
        "mean            ": lambda v: statistics.fmean(v),
        "trimmed mean 1/1": lambda v: trimmed(v, 1),
        "trimmed mean 2/2": lambda v: trimmed(v, 2),
        "trimmed mean 3/3": lambda v: trimmed(v, 3),
    }

    print(f"\n=== estimators over {len(bursts)} bursts of {burst} "
          f"({cap.path.name}) ===")
    print("    estimator          sd (g)      p2p (g)")
    baseline = None
    for name, fn in candidates.items():
        results = [(fn(b) - cap.tare) / cap.cal_factor * 1000.0 for b in bursts]
        s = describe(results)
        if baseline is None:
            baseline = s["sd"]
        delta = f"  ({s['sd'] / baseline * 100:5.1f}% of median)" if baseline else ""
        print(f"    {name}  {s['sd']:9.1f}  {s['p2p']:11.1f}{delta}")


def compare(caps: list[Capture]) -> None:
    print("\n=== comparison ===")
    print(f"    {'capture':<28}{'kind':<10}{'sd (g)':>10}{'p2p (g)':>11}{'drift g/h':>12}")
    for cap in caps:
        g = cap.grams()
        s = describe(g)
        slope = drift(cap.series("t_s"), g)[0] if cap.kind != "dump" else 0.0
        print(f"    {cap.path.name:<28}{cap.kind:<10}{s['sd']:>10.1f}"
              f"{s['p2p']:>11.1f}{slope:>12.1f}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--compare", action="store_true", help="side-by-side table")
    ap.add_argument("--estimators", action="store_true",
                    help="replay a dump capture through each candidate estimator")
    ap.add_argument("--burst", type=int, default=10,
                    help="samples per burst for --estimators (default 10)")
    ap.add_argument("--cal", type=float,
                    help="counts per kg, when the capture has no preamble")
    args = ap.parse_args()

    caps = []
    for path in args.files:
        if not path.exists():
            print(f"missing: {path}", file=sys.stderr)
            return 1
        cap = Capture(path)
        if args.cal:
            cap.meta["cal"] = str(args.cal)
        caps.append(cap)

    for cap in caps:
        summarise(cap)
        if args.estimators and cap.kind == "dump":
            estimators(cap, args.burst)

    if args.compare and len(caps) > 1:
        compare(caps)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
