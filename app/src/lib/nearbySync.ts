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
 * BLE sweep for the caller's hives, then cloud sync. Scales broadcast about
 * once a minute, so we scan up to `scanMs` but stop early once every expected
 * hive has been heard. Every `OA-` scale heard is stored (and its hive created
 * locally if needed), so this also works right after a reinstall when the local
 * DB is empty but hives exist in the cloud.
 *
 * `expectedIds` are the hive ids currently shown on the home list (which may
 * include cloud-only hives not yet in the local DB). They're only used to know
 * when to stop early; readings from any heard scale are captured regardless.
 */
export async function syncNearbyKnownHives(scanMs = 65000, expectedIds?: string[]): Promise<NearbySyncResult> {
  const local = (await listHivesLocal()).map((h) => h.id.toLowerCase());
  const expected = new Set<string>([...(expectedIds ?? []).map((s) => s.toLowerCase()), ...local]);

  await ensureBleReady();

  const heardIds = new Set<string>();
  let stored = 0;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, scanMs);

    void startScan(async (a) => {
      const hiveId = a.deviceName.toLowerCase();
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
      // Stop early once every expected hive has checked in.
      if (expected.size > 0 && [...expected].every((k) => heardIds.has(k))) {
        clearTimeout(timer);
        finish();
      }
    }).catch(() => finish());
  });

  await stopScan().catch(() => undefined);

  return {
    heard: heardIds.size,
    stored,
    cloud: await syncNow(),
  };
}
