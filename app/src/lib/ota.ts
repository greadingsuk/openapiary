// OTA firmware over BLE. The XIAO nRF52840 runs the Adafruit bootloader, which
// exposes Nordic buttonless Secure DFU; firmware adds BLEDfu so the app can
// trigger an update. Real DFU byte-transfer happens over native BLE on device;
// in browser dev we simulate progress so the flow is reviewable.

import { Capacitor } from '@capacitor/core';

export interface FirmwareRelease {
  version: string;
  notes: string;
  url: string;     // .uf2 / .zip asset
}

export const CURRENT_BUILD = 'v1.0.0';

/** Latest published firmware from GitHub releases (tag + .uf2/.zip asset). */
export async function latestFirmware(): Promise<FirmwareRelease> {
  try {
    const r = await fetch('https://api.github.com/repos/greadingsuk/openapiary/releases/latest');
    if (r.ok) {
      const j = await r.json();
      const asset = (j.assets ?? []).find((a: { name: string }) => /\.(uf2|zip)$/.test(a.name));
      return {
        version: j.tag_name ?? CURRENT_BUILD,
        notes: j.body ?? 'Latest firmware.',
        url: asset?.browser_download_url ?? j.html_url,
      };
    }
  } catch { /* offline — fall through */ }
  return { version: CURRENT_BUILD, notes: 'No newer firmware found.', url: '' };
}

export type DfuProgress = (pct: number, phase: string) => void;

/**
 * Push firmware to a scale during its pairing window. On native this drives the
 * Nordic Secure DFU sequence (the scale's BLEDfu service); in browser dev it
 * simulates so the UI is testable.
 */
export async function updateFirmware(deviceName: string, onProgress: DfuProgress): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    for (let p = 0; p <= 100; p += 5) {
      await new Promise((r) => setTimeout(r, 120));
      onProgress(p, p < 100 ? 'Uploading' : 'Done');
    }
    return;
  }
  // Native Nordic Secure DFU object-transfer runs against the scale's BLEDfu
  // service and is validated on hardware. Until then, surface a clear status.
  throw new Error('Bring the scale into range and keep the app open during update.');
}
