// Lightweight per-device metadata (firmware version, last-seen), captured from
// BLE adverts and kept in Preferences. Avoids a DB migration just to surface
// the installed firmware version on the Fleet screen.
import { Preferences } from '@capacitor/preferences';

const KEY = 'openapiary.deviceMeta.v1';

export interface DeviceMeta {
  fw?: string;        // e.g. "v1.0.1"
  lastSeen?: number;  // ms epoch
}

export type DeviceMetaStore = Record<string, DeviceMeta>;

export async function loadDeviceMeta(): Promise<DeviceMetaStore> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return {};
  try {
    return JSON.parse(value) as DeviceMetaStore;
  } catch {
    return {};
  }
}

/** Merge new metadata for a hive (keyed by lowercase hive id). */
export async function recordDeviceMeta(hiveId: string, meta: DeviceMeta): Promise<void> {
  const id = hiveId.toLowerCase();
  const store = await loadDeviceMeta();
  store[id] = { ...store[id], ...meta, lastSeen: Date.now() };
  await Preferences.set({ key: KEY, value: JSON.stringify(store) });
}
