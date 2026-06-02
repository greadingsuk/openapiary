// Sync engine: drains unsynced rows from local SQLite to the Cloudflare Worker.

import { loadSettings } from './settings';
import { postReadings } from './api';
import { unsyncedByHive, markSynced, unsyncedCount } from './db';

let syncing = false;
let timer: number | null = null;

export interface SyncResult {
  attempted: number;
  succeeded: number;
  failed: string[];
}

export async function syncNow(): Promise<SyncResult> {
  if (syncing) return { attempted: 0, succeeded: 0, failed: ['already running'] };
  syncing = true;
  const result: SyncResult = { attempted: 0, succeeded: 0, failed: [] };
  try {
    const s = await loadSettings();
    if (!s.apiKey || !s.syncEnabled) return result;
    const batches = await unsyncedByHive();
    for (const [hiveId, rows] of batches) {
      result.attempted += rows.length;
      try {
        await postReadings(s, hiveId, hiveId.toUpperCase(), rows.map((r) => ({
          ts: r.ts,
          weightKg: r.weight_kg,
          batteryV: r.battery_v,
          tempC: r.temp_c,
          packetId: r.packet_id,
          rssi: r.rssi,
        })));
        await markSynced(hiveId, rows.map((r) => r.ts));
        result.succeeded += rows.length;
      } catch (e: any) {
        result.failed.push(`${hiveId}: ${e.message ?? e}`);
      }
    }
  } finally {
    syncing = false;
  }
  return result;
}

export function startAutoSync(intervalMs = 5 * 60 * 1000) {
  stopAutoSync();
  // Fire one immediately, then on interval.
  void syncNow();
  timer = window.setInterval(() => { void syncNow(); }, intervalMs);
}

export function stopAutoSync() {
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
}

export { unsyncedCount };
