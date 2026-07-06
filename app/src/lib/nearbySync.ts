import { ensureBleReady, startScan, stopScan } from './ble';
import { insertReading, listHivesLocal, upsertHive } from './db';
import { syncNow, type SyncResult } from './sync';

export interface NearbySyncResult {
  heard: number;
  stored: number;
  cloud: SyncResult;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Short BLE sweep for already-known hives from the home list, then cloud sync.
 * This lets users refresh data without going through the Add Hive screen.
 */
export async function syncNearbyKnownHives(scanMs = 7000): Promise<NearbySyncResult> {
  const known = new Set((await listHivesLocal()).map((h) => h.id.toLowerCase()));
  if (!known.size) {
    return {
      heard: 0,
      stored: 0,
      cloud: await syncNow(),
    };
  }

  await ensureBleReady();

  let heard = 0;
  let stored = 0;
  try {
    await startScan(async (a) => {
      const hiveId = a.deviceName.toLowerCase();
      if (!known.has(hiveId)) return;
      heard += 1;
      await upsertHive({ id: hiveId, name: a.deviceName, created_at: Date.now() });
      await insertReading({
        hive_id: hiveId,
        ts: a.ts,
        weight_kg: a.weightKg,
        battery_v: a.batteryV,
        temp_c: a.tempC,
        packet_id: a.packetId,
        rssi: a.rssi,
      });
      stored += 1;
    });

    await delay(scanMs);
  } finally {
    await stopScan().catch(() => undefined);
  }

  return {
    heard,
    stored,
    cloud: await syncNow(),
  };
}
