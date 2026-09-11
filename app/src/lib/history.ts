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
import { logEvent } from './remoteLog';

export interface HistorySyncResult {
  found: boolean;
  added: number;
  weightReceived: number;
  batteryReceived: number;
}

export type SyncPhase = 'waiting' | 'connected' | 'draining';

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
 * advance the sync cursor, then push to the cloud. Native only — needs a real
 * BLE connection.
 *
 * This is ONE bounded "round" (default 2 min): the scale's heartbeat is
 * user-configurable (10s-300s) and only briefly connectable each cycle, so a
 * single round may legitimately not catch it (e.g. a 5-min heartbeat won't
 * necessarily land within one 2-min round). Resolves found:false rather than
 * waiting indefinitely — callers should offer the user another round (see
 * lib/retryRounds.ts) rather than assume one round is always enough.
 *
 * @param fallbackBatteryV last live battery (from an advert) used when a reading
 *   predates any logged battery sample, since the cloud requires a battery value.
 * @param roundMs length of this attempt before giving up (default 120s).
 * @param onPhase optional progress callback: 'waiting' (scanning/connecting) ->
 *   'connected' (session open) -> 'draining' (reading the log).
 */
export async function syncDeviceHistory(
  hiveId: string,
  deviceName: string,
  fallbackBatteryV?: number,
  roundMs = 120000,
  onPhase?: (phase: SyncPhase) => void,
): Promise<HistorySyncResult> {
  await ensureBleReady();
  onPhase?.('waiting');
  void logEvent('info', 'history.round.start', { roundMs }, hiveId);

  const deadline = Date.now() + roundMs;
  let deviceId: string | null = null;
  while (Date.now() < deadline && !deviceId) {
    const id = await findDeviceId(deviceName, Math.min(65000, deadline - Date.now()));
    if (!id) continue; // not heard this pass — keep listening until the round ends
    try {
      await connectDevice(id);
      deviceId = id;
    } catch {
      // Connect raced the connectable window closing — wait a beat and retry.
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (!deviceId) {
    void logEvent('warn', 'history.round.not_found', undefined, hiveId);
    return { found: false, added: 0, weightReceived: 0, batteryReceived: 0 };
  }
  onPhase?.('connected');

  let added = 0;
  let weightReceived = 0;
  let batteryReceived = 0;
  try {
    onPhase?.('draining');
    const { lastWeightSeq, lastBatterySeq } = await getSyncState(hiveId);
    const hist = await drainHistoryConnected(deviceId, lastWeightSeq, lastBatterySeq);
    weightReceived = hist.weight.length;
    batteryReceived = hist.battery.length;

    const battery = [...hist.battery].sort((a, b) => a.epoch - b.epoch);
    const rows: Reading[] = [];
    let skippedNoEpoch = 0;
    for (const w of hist.weight) {
      if (w.epoch === 0) { skippedNoEpoch++; continue; } // written before the clock was ever set — can't place in time
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
    void logEvent('info', 'history.round.drained', {
      lastWeightSeq, lastBatterySeq, weightReceived, batteryReceived, skippedNoEpoch, added,
    }, hiveId);

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
