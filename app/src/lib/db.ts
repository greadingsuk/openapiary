// Local SQLite cache: every BLE advert lands here first, then we push to cloud.
// Uses @capacitor-community/sqlite. On web (dev), we use the jeep-sqlite Worker fallback,
// but if it's not loaded we degrade gracefully to a noop in-memory store so dev doesn't crash.

import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';

const DB_NAME = 'openapiary';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hives (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS readings (
  hive_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  weight_kg REAL,
  battery_v REAL,
  temp_c REAL,
  packet_id INTEGER,
  rssi INTEGER,
  synced INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hive_id, ts)
);
CREATE INDEX IF NOT EXISTS idx_readings_unsynced ON readings(synced) WHERE synced = 0;
CREATE TABLE IF NOT EXISTS deleted_readings (
  hive_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (hive_id, ts)
);
CREATE TABLE IF NOT EXISTS hive_clear_markers (
  hive_id TEXT PRIMARY KEY,
  cleared_before_ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hive_sync (
  hive_id TEXT PRIMARY KEY,
  last_weight_seq INTEGER NOT NULL DEFAULT 0,
  last_battery_seq INTEGER NOT NULL DEFAULT 0
);
`;

let db: SQLiteDBConnection | null = null;
let initPromise: Promise<void> | null = null;

// In-memory fallback for browser dev when jeep-sqlite Web Worker isn't present.
const memReadings: Array<Reading & { synced: number }> = [];
const memHives = new Map<string, Hive>();
const memDeletedReadings = new Map<string, Set<number>>();
const memClearMarkers = new Map<string, number>();
const memSyncState = new Map<string, { lastWeightSeq: number; lastBatterySeq: number }>();
let useMemory = false;

// Synchronous, race-free guard against the scale re-broadcasting the same
// packet_id many times per advertising burst. insertReading is async and its
// DB "is this packet already stored?" check is await-separated, so two advert
// callbacks for the same packet can both pass it and each insert a row with a
// Date.now() timestamp 1 ms apart (distinct under the (hive_id, ts) key).
// Recording the last-seen packet_id synchronously — before any await — closes
// that race. packet_id increments once per reading, so a repeat is a duplicate.
const lastPacketByHive = new Map<string, number>();

export interface Hive {
  id: string;
  name: string;
  created_at: number;
}

export interface Reading {
  hive_id: string;
  ts: number;
  weight_kg?: number;
  battery_v?: number;
  temp_c?: number;
  packet_id?: number;
  rssi?: number;
}

function isSuppressedInMemory(hiveId: string, ts: number): boolean {
  const cutoff = memClearMarkers.get(hiveId) ?? 0;
  if (ts <= cutoff) return true;
  return (memDeletedReadings.get(hiveId)?.has(ts)) ?? false;
}

async function isSuppressedInDb(hiveId: string, ts: number): Promise<boolean> {
  const clearRow = await db!.query(
    'SELECT cleared_before_ts FROM hive_clear_markers WHERE hive_id = ? LIMIT 1',
    [hiveId],
  );
  const cutoff = (clearRow.values?.[0] as { cleared_before_ts?: number } | undefined)?.cleared_before_ts ?? 0;
  if (ts <= cutoff) return true;
  const delRow = await db!.query(
    'SELECT 1 AS n FROM deleted_readings WHERE hive_id = ? AND ts = ? LIMIT 1',
    [hiveId, ts],
  );
  return (delRow.values?.length ?? 0) > 0;
}

async function markDeletedReadings(hiveId: string, timestamps: number[]): Promise<void> {
  if (!timestamps.length) return;
  if (useMemory) {
    const cur = memDeletedReadings.get(hiveId) ?? new Set<number>();
    for (const ts of timestamps) cur.add(ts);
    memDeletedReadings.set(hiveId, cur);
    return;
  }
  const stmts = timestamps.map((ts) =>
    db!.run(
      'INSERT OR IGNORE INTO deleted_readings (hive_id, ts) VALUES (?, ?)',
      [hiveId, ts],
    ));
  await Promise.all(stmts);
}

async function markHiveCleared(hiveId: string, clearedBeforeTs: number): Promise<void> {
  if (useMemory) {
    memClearMarkers.set(hiveId, clearedBeforeTs);
    memDeletedReadings.delete(hiveId);
    return;
  }
  await db!.run(
    `INSERT INTO hive_clear_markers (hive_id, cleared_before_ts)
     VALUES (?, ?)
     ON CONFLICT(hive_id) DO UPDATE SET
       cleared_before_ts = MAX(hive_clear_markers.cleared_before_ts, excluded.cleared_before_ts)`,
    [hiveId, clearedBeforeTs],
  );
  await db!.run('DELETE FROM deleted_readings WHERE hive_id = ?', [hiveId]);
}

export async function getDeletionState(hiveId: string): Promise<{ clearedBeforeTs: number; deletedTs: Set<number> }> {
  await initDb();
  if (useMemory) {
    return {
      clearedBeforeTs: memClearMarkers.get(hiveId) ?? 0,
      deletedTs: new Set(memDeletedReadings.get(hiveId) ?? []),
    };
  }
  const clearRow = await db!.query(
    'SELECT cleared_before_ts FROM hive_clear_markers WHERE hive_id = ? LIMIT 1',
    [hiveId],
  );
  const cutoff = (clearRow.values?.[0] as { cleared_before_ts?: number } | undefined)?.cleared_before_ts ?? 0;
  const delRows = await db!.query('SELECT ts FROM deleted_readings WHERE hive_id = ?', [hiveId]);
  const deletedTs = new Set<number>((delRows.values ?? []).map((r) => (r as { ts: number }).ts));
  return { clearedBeforeTs: cutoff, deletedTs };
}

export async function initDb(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const platform = Capacitor.getPlatform();
    if (platform === 'web') {
      // Browser dev fallback. Skipping the jeep-sqlite Web Worker setup to keep dev simple.
      useMemory = true;
      return;
    }
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    const exists = (await sqlite.isConnection(DB_NAME, false)).result;
    db = exists
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
    await db.open();
    await db.execute(SCHEMA);
  })();
  return initPromise;
}

export async function upsertHive(h: Hive): Promise<void> {
  await initDb();
  if (useMemory) {
    const existing = memHives.get(h.id);
    // Preserve a user-set name; only set it on first insert.
    memHives.set(h.id, existing ? { ...existing } : h);
    return;
  }
  // Insert the hive on first sight, but NEVER overwrite an existing name — the
  // user may have renamed it. Every BLE advert calls this, so an upsert that
  // replaced the name would keep resetting it back to "OA-XXXX".
  await db!.run(
    `INSERT INTO hives (id, name, created_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
    [h.id, h.name, h.created_at],
  );
}

export async function insertReading(r: Reading): Promise<void> {
  // Race-free duplicate guard: runs before any await so two advert callbacks
  // for the same packet in one tick can't both slip past. See lastPacketByHive.
  if (r.packet_id != null) {
    if (lastPacketByHive.get(r.hive_id) === r.packet_id) return;
    lastPacketByHive.set(r.hive_id, r.packet_id);
  }
  await initDb();
  if (useMemory) {
    if (isSuppressedInMemory(r.hive_id, r.ts)) return;
  } else if (await isSuppressedInDb(r.hive_id, r.ts)) {
    return;
  }

  // De-duplicate repeated adverts: the scale re-broadcasts the same payload
  // (same packet_id) many times per cycle. Skip if the newest stored reading
  // for this hive already carries this packet_id.
  if (r.packet_id != null) {
    if (useMemory) {
      let newest: (Reading & { synced: number }) | undefined;
      for (const m of memReadings) {
        if (m.hive_id === r.hive_id && (!newest || m.ts > newest.ts)) newest = m;
      }
      if (newest && newest.packet_id === r.packet_id) return;
    } else {
      const res = await db!.query(
        'SELECT packet_id FROM readings WHERE hive_id = ? ORDER BY ts DESC LIMIT 1',
        [r.hive_id],
      );
      const lastPid = (res.values?.[0] as { packet_id: number | null } | undefined)?.packet_id;
      if (lastPid != null && lastPid === r.packet_id) return;
    }
  }

  if (useMemory) {
    memReadings.push({ ...r, synced: 0 });
    return;
  }
  await db!.run(
    `INSERT OR IGNORE INTO readings
      (hive_id, ts, weight_kg, battery_v, temp_c, packet_id, rssi, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [r.hive_id, r.ts, r.weight_kg ?? null, r.battery_v ?? null,
     r.temp_c ?? null, r.packet_id ?? null, r.rssi ?? null],
  );
}

// Backfill rows drained from the scale's on-device log. Unlike insertReading,
// this does NOT apply the live-advert packet-id de-dup guard (historical seqs
// share the packet-id space with live adverts); duplicates are prevented by the
// (hive_id, ts) primary key. Honours deletion / clear-marker suppression.
export async function insertHistoricalReadings(hiveId: string, rows: Reading[]): Promise<number> {
  await initDb();
  if (useMemory) {
    let added = 0;
    for (const r of rows) {
      if (isSuppressedInMemory(hiveId, r.ts)) continue;
      if (memReadings.some((m) => m.hive_id === hiveId && m.ts === r.ts)) continue;
      memReadings.push({ ...r, hive_id: hiveId, synced: 0 });
      added++;
    }
    return added;
  }
  // Build the batch (skipping user-cleared timestamps) and insert it in a SINGLE
  // transaction, so an interrupted drain can't leave a half-written batch.
  // INSERT OR IGNORE + the UNIQUE(hive_id, ts) key still dedupe on any retry.
  const set: { statement: string; values: (string | number | null)[] }[] = [];
  for (const r of rows) {
    if (await isSuppressedInDb(hiveId, r.ts)) continue;
    set.push({
      statement: `INSERT OR IGNORE INTO readings
        (hive_id, ts, weight_kg, battery_v, temp_c, packet_id, rssi, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      values: [hiveId, r.ts, r.weight_kg ?? null, r.battery_v ?? null,
               r.temp_c ?? null, r.packet_id ?? null, r.rssi ?? null],
    });
  }
  if (set.length) await db!.executeSet(set);
  return set.length;
}

export async function unsyncedByHive(): Promise<Map<string, Reading[]>> {
  await initDb();
  const out = new Map<string, Reading[]>();
  if (useMemory) {
    for (const r of memReadings) {
      if (r.synced) continue;
      const arr = out.get(r.hive_id) ?? [];
      arr.push(r);
      out.set(r.hive_id, arr);
    }
    return out;
  }
  const res = await db!.query(
    'SELECT hive_id, ts, weight_kg, battery_v, temp_c, packet_id, rssi FROM readings WHERE synced = 0 ORDER BY ts ASC LIMIT 500',
  );
  for (const row of res.values ?? []) {
    const r = row as Reading;
    const arr = out.get(r.hive_id) ?? [];
    arr.push(r);
    out.set(r.hive_id, arr);
  }
  return out;
}

export async function markSynced(hiveId: string, timestamps: number[]): Promise<void> {
  await initDb();
  if (!timestamps.length) return;
  if (useMemory) {
    for (const r of memReadings) {
      if (r.hive_id === hiveId && timestamps.includes(r.ts)) r.synced = 1;
    }
    return;
  }
  const placeholders = timestamps.map(() => '?').join(',');
  await db!.run(
    `UPDATE readings SET synced = 1 WHERE hive_id = ? AND ts IN (${placeholders})`,
    [hiveId, ...timestamps],
  );
}

export async function unsyncedCount(): Promise<number> {
  await initDb();
  if (useMemory) return memReadings.filter((r) => !r.synced).length;
  const res = await db!.query('SELECT COUNT(*) AS n FROM readings WHERE synced = 0');
  return (res.values?.[0] as { n: number } | undefined)?.n ?? 0;
}

/** Highest on-device log seq already drained for a hive (0 = none yet). */
export async function getSyncState(hiveId: string): Promise<{ lastWeightSeq: number; lastBatterySeq: number }> {
  await initDb();
  if (useMemory) {
    return memSyncState.get(hiveId) ?? { lastWeightSeq: 0, lastBatterySeq: 0 };
  }
  const res = await db!.query(
    'SELECT last_weight_seq, last_battery_seq FROM hive_sync WHERE hive_id = ? LIMIT 1',
    [hiveId],
  );
  const row = res.values?.[0] as { last_weight_seq?: number; last_battery_seq?: number } | undefined;
  return { lastWeightSeq: row?.last_weight_seq ?? 0, lastBatterySeq: row?.last_battery_seq ?? 0 };
}

/** Record the highest drained log seq for a hive (monotonic; never goes back). */
export async function setSyncState(hiveId: string, lastWeightSeq: number, lastBatterySeq: number): Promise<void> {
  await initDb();
  if (useMemory) {
    const cur = memSyncState.get(hiveId) ?? { lastWeightSeq: 0, lastBatterySeq: 0 };
    memSyncState.set(hiveId, {
      lastWeightSeq: Math.max(cur.lastWeightSeq, lastWeightSeq),
      lastBatterySeq: Math.max(cur.lastBatterySeq, lastBatterySeq),
    });
    return;
  }
  await db!.run(
    `INSERT INTO hive_sync (hive_id, last_weight_seq, last_battery_seq)
     VALUES (?, ?, ?)
     ON CONFLICT(hive_id) DO UPDATE SET
       last_weight_seq  = MAX(hive_sync.last_weight_seq, excluded.last_weight_seq),
       last_battery_seq = MAX(hive_sync.last_battery_seq, excluded.last_battery_seq)`,
    [hiveId, lastWeightSeq, lastBatterySeq],
  );
}

// ---------------------------------------------------------------------------
// Offline-first read helpers. Screens read from these FIRST (instant, works
// offline); cloud data is merged in on top when a network is available.
// ---------------------------------------------------------------------------

export async function listHivesLocal(): Promise<Hive[]> {
  await initDb();
  if (useMemory) {
    return [...memHives.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  const res = await db!.query('SELECT id, name, created_at FROM hives ORDER BY name ASC');
  return (res.values ?? []) as Hive[];
}

/** Latest reading for a single hive, or null if none cached. */
export async function latestReading(hiveId: string): Promise<Reading | null> {
  await initDb();
  if (useMemory) {
    const rows = memReadings.filter((r) => r.hive_id === hiveId).sort((a, b) => b.ts - a.ts);
    return rows[0] ?? null;
  }
  const res = await db!.query(
    `SELECT hive_id, ts, weight_kg, battery_v, temp_c, packet_id, rssi
       FROM readings WHERE hive_id = ? ORDER BY ts DESC LIMIT 1`,
    [hiveId],
  );
  return (res.values?.[0] as Reading | undefined) ?? null;
}

/** Latest reading for every known hive, keyed by hive id. */
export async function latestReadingPerHive(): Promise<Map<string, Reading>> {
  await initDb();
  const out = new Map<string, Reading>();
  if (useMemory) {
    for (const r of memReadings) {
      const cur = out.get(r.hive_id);
      if (!cur || r.ts > cur.ts) out.set(r.hive_id, r);
    }
    return out;
  }
  const res = await db!.query(
    `SELECT r.hive_id, r.ts, r.weight_kg, r.battery_v, r.temp_c, r.packet_id, r.rssi
       FROM readings r
       JOIN (SELECT hive_id, MAX(ts) AS mts FROM readings GROUP BY hive_id) m
         ON m.hive_id = r.hive_id AND m.mts = r.ts`,
  );
  for (const row of res.values ?? []) {
    const r = row as Reading;
    out.set(r.hive_id, r);
  }
  return out;
}

/** Readings for a hive newer than `sinceMs` (0 = all), oldest-first for charting. */
export async function getReadingsLocal(hiveId: string, sinceMs = 0): Promise<Reading[]> {
  await initDb();
  if (useMemory) {
    return memReadings
      .filter((r) => r.hive_id === hiveId && r.ts >= sinceMs)
      .sort((a, b) => a.ts - b.ts)
      .map((r) => ({
        hive_id: r.hive_id, ts: r.ts, weight_kg: r.weight_kg, battery_v: r.battery_v,
        temp_c: r.temp_c, packet_id: r.packet_id, rssi: r.rssi,
      }));
  }
  const res = await db!.query(
    `SELECT hive_id, ts, weight_kg, battery_v, temp_c, packet_id, rssi
       FROM readings WHERE hive_id = ? AND ts >= ? ORDER BY ts ASC`,
    [hiveId, sinceMs],
  );
  return (res.values ?? []) as Reading[];
}

export async function hiveCount(): Promise<number> {
  await initDb();
  if (useMemory) return memHives.size;
  const res = await db!.query('SELECT COUNT(*) AS n FROM hives');
  return (res.values?.[0] as { n: number } | undefined)?.n ?? 0;
}

/** Rename a cached hive locally (mirrors a successful device/cloud rename). */
export async function renameHiveLocal(hiveId: string, name: string): Promise<void> {
  await initDb();
  if (useMemory) {
    const h = memHives.get(hiveId);
    if (h) memHives.set(hiveId, { ...h, name });
    return;
  }
  await db!.run('UPDATE hives SET name = ? WHERE id = ?', [name, hiveId]);
}

/** Permanently delete specific readings for a hive (e.g. an inspection skew). */
export async function deleteReadings(hiveId: string, timestamps: number[]): Promise<void> {
  await initDb();
  if (!timestamps.length) return;
  await markDeletedReadings(hiveId, timestamps);
  if (useMemory) {
    for (let i = memReadings.length - 1; i >= 0; i--) {
      const r = memReadings[i];
      if (r.hive_id === hiveId && timestamps.includes(r.ts)) memReadings.splice(i, 1);
    }
    return;
  }
  const ph = timestamps.map(() => '?').join(',');
  await db!.run(`DELETE FROM readings WHERE hive_id = ? AND ts IN (${ph})`, [hiveId, ...timestamps]);
}

/** Permanently delete all cached readings for a hive. */
export async function deleteAllReadings(hiveId: string): Promise<void> {
  await initDb();
  await markHiveCleared(hiveId, Date.now());
  if (useMemory) {
    for (let i = memReadings.length - 1; i >= 0; i--) {
      if (memReadings[i].hive_id === hiveId) memReadings.splice(i, 1);
    }
    return;
  }
  await db!.run('DELETE FROM readings WHERE hive_id = ?', [hiveId]);
}

/** Wipe all cached hives + readings (used on sign-out so accounts don't bleed). */
export async function clearLocalData(): Promise<void> {
  await initDb();
  if (useMemory) {
    memReadings.length = 0;
    memHives.clear();
    memDeletedReadings.clear();
    memClearMarkers.clear();
    return;
  }
  await db!.execute('DELETE FROM deleted_readings; DELETE FROM hive_clear_markers; DELETE FROM readings; DELETE FROM hives;');
}
