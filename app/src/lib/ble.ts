// BLE scanner for OpenApiary BTHome adverts.
// Uses @capacitor-community/bluetooth-le, which works on iOS, Android,
// and (with the Web Bluetooth fallback for scanning -- limited) the browser.

import { BleClient, type ScanResult } from '@capacitor-community/bluetooth-le';
import { BTHOME_SERVICE_UUID_128, parseBTHome, type BTHomeReading } from './bthome';

export interface OAAdvert extends BTHomeReading {
  deviceId: string;       // MAC on Android, opaque UUID on iOS
  deviceName: string;     // "OA-XXXX"
  rssi: number;
  ts: number;             // ms epoch (phone clock)
}

let initialised = false;

async function ensureInit() {
  if (initialised) return;
  await BleClient.initialize({ androidNeverForLocation: true });
  initialised = true;
}

/**
 * Force the BLE stack to initialise and confirm the radio is enabled.
 * On iOS, calling initialize() then isEnabled() triggers the CoreBluetooth
 * permission prompt the first time and adds the toggle to iOS Settings.
 * Throws a human-readable error the UI can display.
 */
export async function ensureBleReady(): Promise<void> {
  try {
    await ensureInit();
  } catch (e: any) {
    throw new Error(`BLE init failed: ${e?.message ?? e}`);
  }
  let enabled = false;
  try {
    enabled = await BleClient.isEnabled();
  } catch (e: any) {
    throw new Error(`Bluetooth permission/unavailable: ${e?.message ?? e}`);
  }
  if (!enabled) {
    throw new Error('Bluetooth is off. Turn it on in Control Centre / Settings.');
  }
}

function extractServiceData(result: ScanResult): Uint8Array | null {
  const sd = result.serviceData?.[BTHOME_SERVICE_UUID_128];
  if (!sd) return null;
  // Capacitor returns DataView; normalise to Uint8Array.
  return new Uint8Array(sd.buffer, sd.byteOffset, sd.byteLength);
}

export async function startScan(onAdvert: (a: OAAdvert) => void): Promise<void> {
  await ensureInit();
  await BleClient.requestLEScan(
    { services: [BTHOME_SERVICE_UUID_128], allowDuplicates: true },
    (result) => {
      const name = result.localName ?? result.device.name ?? '';
      if (!name.startsWith('OA-')) return;
      const payload = extractServiceData(result);
      if (!payload) return;
      const reading = parseBTHome(payload);
      if (!reading) return;
      onAdvert({
        ...reading,
        deviceId: result.device.deviceId,
        deviceName: name,
        rssi: result.rssi ?? 0,
        ts: Date.now(),
      });
    },
  );
}

export async function stopScan(): Promise<void> {
  if (!initialised) return;
  try {
    await BleClient.stopLEScan();
  } catch {
    // ignore - scan may have already stopped
  }
}
