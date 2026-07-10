// Drain the scale's on-device reading log over BLE and backfill local history.
//
// The scale (firmware v1.0.9+) logs a full weight/temp reading every 15 min
// (1 h in winter) plus hourly battery to a flash ring buffer, so a field device
// keeps ~2 months of data between visits. The iOS app can't background-scan
// every advert, so passive capture leaves gaps — this pulls the authoritative,
// exactly-timestamped record on connect and feeds it into the same local
// SQLite + cloud-sync path as live adverts.

import {
  ensureBleReady, findDeviceId, connectDevice, disconnectDevice,
  drainHistoryConnected, type HistBatteryRecord,
} from './ble';
import { getSyncState, setSyncState, insertHistoricalReadings, type Reading } from './db';
import { syncNow } from './sync';

export interface HistorySyncResult {
  found: boolean;
  added: number;
  weightReceived: number;
  batteryReceived: number;
}

// Nearest battery voltage at or before a given epoch (battery is logged hourly).
function batteryAt(sortedBattery: HistBatteryRecord[], epoch: number, fallback?: number): number | undefined {
  if (sortedBattery.length === 0) return fallback;
  let lo = 0, hi = sortedBattery.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedBattery[mid].epoch <= epoch) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (best >= 0) return sortedBattery[best].batteryV;
  return sortedBattery[0].batteryV; // all battery records are after this reading
}

/**
 * Connect to a scale by name, drain any new log records, insert them locally,
 * advance the sync cursor, then push to the cloud. Best-effort: silently
 * resolves with found:false if the scale isn't heard (asleep / out of range).
 * Native only — needs a real BLE connection.
 *
 * @param fallbackBatteryV last live battery (from an advert) used when a reading
 *   predates any logged battery sample, since the cloud requires a battery value.
 */
export async function syncDeviceHistory(
  hiveId: string,
  deviceName: string,
  fallbackBatteryV?: number,
): Promise<HistorySyncResult> {
  await ensureBleReady();
  const deviceId = await findDeviceId(deviceName, 8000);
  if (!deviceId) return { found: false, added: 0, weightReceived: 0, batteryReceived: 0 };

  await connectDevice(deviceId);
  let added = 0;
  let weightReceived = 0;
  let batteryReceived = 0;
  try {
    const { lastWeightSeq, lastBatterySeq } = await getSyncState(hiveId);
    const hist = await drainHistoryConnected(deviceId, lastWeightSeq, lastBatterySeq);
    weightReceived = hist.weight.length;
    batteryReceived = hist.battery.length;

    const battery = [...hist.battery].sort((a, b) => a.epoch - b.epoch);
    const rows: Reading[] = [];
    for (const w of hist.weight) {
      if (w.epoch === 0) continue; // written before the clock was ever set — can't place in time
      rows.push({
        hive_id: hiveId,
        ts: w.epoch * 1000,
        weight_kg: w.weightKg,
        temp_c: w.tempC,
        battery_v: batteryAt(battery, w.epoch, fallbackBatteryV),
        packet_id: w.seq,
      });
    }
    added = await insertHistoricalReadings(hiveId, rows);

    const maxWeightSeq = hist.weight.reduce((m, r) => Math.max(m, r.seq), lastWeightSeq);
    const maxBatterySeq = hist.battery.reduce((m, r) => Math.max(m, r.seq), lastBatterySeq);
    await setSyncState(hiveId, maxWeightSeq, maxBatterySeq);
  } finally {
    await disconnectDevice(deviceId);
  }

  // Push the backfilled rows to the cloud (best-effort).
  try { await syncNow(); } catch { /* offline — will sync later */ }

  return { found: true, added, weightReceived, batteryReceived };
}
