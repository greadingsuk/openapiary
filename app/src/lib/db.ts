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
