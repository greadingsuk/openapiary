// Lightweight per-device metadata (firmware version, last-seen), captured from
// BLE adverts and kept in Preferences. Avoids a DB migration just to surface
// the installed firmware version on the Fleet screen.
import { Preferences } from '@capacitor/preferences';

const KEY = 'openapiary.deviceMeta.v1';

export interface DeviceMeta {
  fw?: string;        // e.g. "v1.0.1"
  lastSeen?: number;  // ms epoch
  summerHeartbeatSec?: number;
  winterHeartbeatSec?: number;
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

// Mirrors firmware's isWinter() in main.cpp: winter = Nov, Dec, Jan, Feb.
export function isWinterMonth(d: Date = new Date()): boolean {
  const m = d.getMonth(); // 0=Jan .. 11=Dec
  return m === 10 || m === 11 || m === 0 || m === 1;
}

// Default assumed until the app has actually read the scale's real interval
// config (via "Measurement intervals") — matches firmware's own default.
export const DEFAULT_HEARTBEAT_SEC = 60;

/** The heartbeat cadence (seconds) currently in effect for a hive, based on
 * the last interval config we've read from it, falling back to the firmware
 * default if we've never opened "Measurement intervals" on it. */
export function activeHeartbeatSec(meta: DeviceMeta | undefined, now: Date = new Date()): number {
  if (!meta) return DEFAULT_HEARTBEAT_SEC;
  const sec = isWinterMonth(now) ? meta.winterHeartbeatSec : meta.summerHeartbeatSec;
  return sec ?? DEFAULT_HEARTBEAT_SEC;
}

/** A one-shot live-advert scan window long enough to reliably hear a scale on
 * the given heartbeat cadence (with margin), so a quick "refresh" doesn't
 * falsely report "not heard" just because the heartbeat was turned down. */
export function scanWindowMsFor(heartbeatSec: number): number {
  return Math.max(65000, (heartbeatSec + 15) * 1000);
}

export function fmtHeartbeat(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const min = sec / 60;
  return Number.isInteger(min) ? `${min} min` : `${min.toFixed(1)} min`;
}
