// A small telemetry tile: label + big tabular value + optional unit/sub.
// Used on the hive detail screen and the in-app fleet overview.

import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  unit?: string;
  /** Secondary line under the value (e.g. "2 min ago"). */
  sub?: string;
  /** Accent the value in honey (e.g. the primary weight reading). */
  accent?: boolean;
}

export default function StatTile({ label, value, unit, sub, accent }: Props) {
  return (
    <div className="oa-stat flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide oa-subtle">{label}</span>
      <span className="flex items-baseline gap-1">
        <span
          className="oa-numeral text-2xl font-semibold"
          style={{ color: accent ? 'var(--oa-honey-700)' : 'var(--oa-ink)' }}
        >
          {value}
        </span>
        {unit && <span className="text-sm oa-muted">{unit}</span>}
      </span>
      {sub && <span className="text-xs oa-subtle">{sub}</span>}
    </div>
  );
}
