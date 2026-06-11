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

/** Reject if a native call doesn't settle in `ms` — prevents the UI hanging forever. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function ensureInit() {
  if (initialised) return;
  // 30 s, not 8 s: on first run iOS shows the permission dialog and
  // initialize() only resolves AFTER the user taps Allow. A short timeout
  // races the human and aborts before permission is granted.
  await withTimeout(
    BleClient.initialize({ androidNeverForLocation: true }),
    30000,
    'Bluetooth initialise',
  );
  initialised = true;
}

/**
 * Initialise the BLE stack. We deliberately do NOT gate on isEnabled():
 * on iOS isEnabled() can block on the CoreBluetooth state callback and never
 * resolve. The scan call itself triggers the iOS permission prompt and will
 * reject with a readable error if Bluetooth is off or unauthorised.
 * isEnabled() is consulted only as a best-effort hint, with its own timeout.
 */
export async function ensureBleReady(): Promise<void> {
  try {
    await ensureInit();
  } catch (e: any) {
    throw new Error(`BLE init failed: ${e?.message ?? e}`);
  }
  // Best-effort radio check — never let it block the scan.
  try {
    const enabled = await withTimeout(BleClient.isEnabled(), 3000, 'Bluetooth check');
    if (!enabled) {
      throw new Error('Bluetooth is off. Turn it on in Control Centre / Settings.');
    }
  } catch (e: any) {
    // If the check itself timed out, fall through and let the scan try anyway.
    if (String(e?.message).includes('is off')) throw e;
    // otherwise ignore the hint and proceed to scan
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
  await withTimeout(
    BleClient.requestLEScan(
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
  ),
    10000,
    'Start scan',
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
