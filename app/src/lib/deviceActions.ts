// Orchestrates a hive rename across the three places a name can live:
//   1. Local SQLite cache    — always, instant, offline-safe.
//   2. Cloud (D1 via Worker)  — when online + API key set.
//   3. The scale itself (BLE) — best-effort, only during its pairing window.
//
// Each leg is independent: the friendly name updates even if the scale is
// asleep, and we report exactly what happened so the UI can be honest.

import { renameHiveLocal } from './db';
import { patchHive } from './api';
import { loadSettings } from './settings';
import { configureDevice, findDeviceId } from './ble';
import { Capacitor } from '@capacitor/core';

export interface RenameResult {
  local: boolean;
  cloud: 'ok' | 'skipped' | 'failed';
  device: 'ok' | 'not-found' | 'failed' | 'unsupported';
  detail?: string;
}

/**
 * @param hiveId      local id (lowercased device name, e.g. "oa-abcb")
 * @param deviceName  the BLE local name to look for (e.g. "OA-ABCB")
 * @param newName     friendly name to set (trimmed to 16 chars on the device)
 */
export async function renameHive(
  hiveId: string,
  deviceName: string,
  newName: string,
): Promise<RenameResult> {
  const result: RenameResult = { local: false, cloud: 'skipped', device: 'unsupported' };

  // 1. Local cache.
  await renameHiveLocal(hiveId, newName);
  result.local = true;

  // 2. Cloud.
  try {
    const s = await loadSettings();
    if (s.apiKey && (typeof navigator === 'undefined' || navigator.onLine)) {
      await patchHive(s, hiveId, { name: newName });
      result.cloud = 'ok';
    }
  } catch (e) {
    result.cloud = 'failed';
    result.detail = e instanceof Error ? e.message : String(e);
  }

  // 3. The device over BLE (native platforms only).
  if (Capacitor.isNativePlatform()) {
    try {
      const id = await findDeviceId(deviceName);
      if (!id) {
        result.device = 'not-found';
      } else {
        // Push the new name and re-seed the clock while we're connected.
        await configureDevice(id, { name: newName, pushTime: true });
        result.device = 'ok';
      }
    } catch (e) {
      result.device = 'failed';
      result.detail = e instanceof Error ? e.message : String(e);
    }
  }

  return result;
}

/** Human-readable summary of a rename for a toast/note. */
export function describeRename(r: RenameResult): string {
  const parts: string[] = ['Renamed'];
  if (r.cloud === 'ok') parts.push('· synced to cloud');
  if (r.device === 'ok') parts.push('· updated on scale');
  else if (r.device === 'not-found') parts.push('· scale not in range (name will apply locally)');
  else if (r.device === 'failed') parts.push('· could not reach scale');
  return parts.join(' ');
}
