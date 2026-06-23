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
`;

let db: SQLiteDBConnection | null = null;
let initPromise: Promise<void> | null = null;

// In-memory fallback for browser dev when jeep-sqlite Web Worker isn't present.
const memReadings: Array<Reading & { synced: number }> = [];
const memHives = new Map<string, Hive>();
let useMemory = false;

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
  if (useMemory) { memHives.set(h.id, h); return; }
  await db!.run(
    'INSERT OR REPLACE INTO hives (id, name, created_at) VALUES (?, ?, ?)',
    [h.id, h.name, h.created_at],
  );
}

export async function insertReading(r: Reading): Promise<void> {
  await initDb();
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

/** Wipe all cached hives + readings (used on sign-out so accounts don't bleed). */
export async function clearLocalData(): Promise<void> {
  await initDb();
  if (useMemory) {
    memReadings.length = 0;
    memHives.clear();
    return;
  }
  await db!.execute('DELETE FROM readings; DELETE FROM hives;');
}
