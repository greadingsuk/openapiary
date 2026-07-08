import { ensureBleReady, startScan, stopScan } from './ble';
import { insertReading, listHivesLocal, upsertHive } from './db';
import { recordDeviceMeta } from './deviceMeta';
import { syncNow, type SyncResult } from './sync';

export interface NearbySyncResult {
  heard: number;
  stored: number;
  cloud: SyncResult;
}

/**
 * BLE sweep for already-known hives from the home list, then cloud sync.
 * Scales only broadcast about once a minute, so we scan up to `scanMs` but stop
 * early as soon as every known hive has been heard. Lets users refresh data
 * without going through the Add Hive screen.
 */
export async function syncNearbyKnownHives(scanMs = 65000): Promise<NearbySyncResult> {
  const known = new Set((await listHivesLocal()).map((h) => h.id.toLowerCase()));
  if (!known.size) {
    return {
      heard: 0,
      stored: 0,
      cloud: await syncNow(),
    };
  }

  await ensureBleReady();

  const heardIds = new Set<string>();
  let stored = 0;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, scanMs);

    void startScan(async (a) => {
      const hiveId = a.deviceName.toLowerCase();
      if (!known.has(hiveId)) return;
      heardIds.add(hiveId);
      await upsertHive({ id: hiveId, name: a.deviceName, created_at: Date.now() });
      if (a.fwVersion) await recordDeviceMeta(hiveId, { fw: a.fwVersion });
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
      // Stop early once every known hive has checked in.
      if (heardIds.size >= known.size) { clearTimeout(timer); finish(); }
    }).catch(() => finish());
  });

  await stopScan().catch(() => undefined);

  return {
    heard: heardIds.size,
    stored,
    cloud: await syncNow(),
  };
}
