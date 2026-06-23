// Shared freshness logic: an Open Apiary scale broadcasts on a known cadence
// (1 min daytime / 5 min night). If we haven't heard from it in well over the
// expected interval, the data is "stale" and the UI must say so honestly
// rather than implying live data (style guide §11).

export type Freshness = 'live' | 'recent' | 'stale' | 'unknown';

/** Daytime adverts arrive ~every 60 s; allow generous slack for missed packets. */
const LIVE_MS = 3 * 60 * 1000;      // <3 min  → live
const RECENT_MS = 30 * 60 * 1000;   // <30 min → recent
// older than RECENT_MS → stale

export function freshnessFor(lastSeenMs: number | null | undefined, now = Date.now()): Freshness {
  if (lastSeenMs == null) return 'unknown';
  const age = now - lastSeenMs;
  if (age < LIVE_MS) return 'live';
  if (age < RECENT_MS) return 'recent';
  return 'stale';
}

export function freshnessLabel(f: Freshness): string {
  switch (f) {
    case 'live': return 'Live';
    case 'recent': return 'Recent';
    case 'stale': return 'Stale';
    default: return 'No data';
  }
}

/** Maps a freshness state to the .oa-dot modifier class. */
export function freshnessDotClass(f: Freshness): string {
  switch (f) {
    case 'live': return 'oa-dot--live';
    case 'recent': return 'oa-dot--live';
    case 'stale': return 'oa-dot--stale';
    default: return 'oa-dot--idle';
  }
}

/** Human "2 min ago" / "3 h ago" / "5 d ago". */
export function relativeTime(tsMs: number | null | undefined, now = Date.now()): string {
  if (tsMs == null) return '—';
  const s = Math.max(0, Math.round((now - tsMs) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}
