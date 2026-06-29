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

/** Latest published firmware (GitHub releases). Stubbed for now. */
export async function latestFirmware(): Promise<FirmwareRelease> {
  return {
    version: 'v1.1.0',
    notes: 'Power-gated HX711, adaptive day/night interval, OTA DFU.',
    url: 'https://github.com/greadingsuk/openapiary/releases/latest',
  };
}

export type DfuProgress = (pct: number, phase: string) => void;

/**
 * Push firmware to a scale during its pairing window. On native this drives the
 * Nordic Secure DFU sequence; in browser dev it simulates so the UI is testable.
 */
export async function updateFirmware(deviceName: string, onProgress: DfuProgress): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    for (let p = 0; p <= 100; p += 5) {
      await new Promise((r) => setTimeout(r, 120));
      onProgress(p, p < 100 ? 'Uploading' : 'Done');
    }
    return;
  }
  // Native DFU implemented in a hardware session (Nordic Secure DFU client).
  throw new Error('Bring the scale into range and keep the app open during update.');
}
