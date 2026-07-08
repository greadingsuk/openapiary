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

// ---------------------------------------------------------------------------
// Device interaction (rename + time sync) over a short GATT connection.
//
// The firmware exposes a connectable "OA Config" service during a ~60 s pairing
// window after boot. We connect, write the new name and/or the current time,
// then disconnect so the scale drops back to advert-only, low-power mode.
//
// These UUIDs MUST match firmware/src (see the GATT service definition).
// ---------------------------------------------------------------------------

export const OA_CONFIG_SERVICE = '0a000000-0a51-4000-b000-000000000001';
export const OA_CHAR_NAME      = '0a000001-0a51-4000-b000-000000000001'; // utf-8, max 16 bytes
export const OA_CHAR_TIME      = '0a000002-0a51-4000-b000-000000000001'; // 8 bytes: u32 epoch LE + i16 tzOffsetMin LE
export const OA_CHAR_TARE      = '0a000003-0a51-4000-b000-000000000001'; // write any byte -> tare now
export const OA_CHAR_SAMPLE    = '0a000004-0a51-4000-b000-000000000001'; // write to refresh, read diagnostics payload
export const OA_CHAR_CALIB     = '0a000006-0a51-4000-b000-000000000001'; // 2 bytes: u16 known weight grams LE -> recompute factor

export interface OADiagnostics {
  weightKg: number;
  spreadG: number;
  rawCounts: number;
}

function oneByte(v: number): DataView {
  const dv = new DataView(new ArrayBuffer(1));
  dv.setUint8(0, v & 0xff);
  return dv;
}

function toBytes(v: DataView): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

function parseDiagnostics(v: DataView): OADiagnostics {
  const b = toBytes(v);
  if (b.length < 10) throw new Error('Scale diagnostics payload is malformed.');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const status = dv.getUint8(0);
  if (status !== 0) throw new Error('Scale reported a diagnostics error.');
  const weightCentiKg = dv.getInt16(2, true);
  const spreadG = dv.getUint16(4, true);
  const rawCounts = dv.getInt32(6, true);
  return {
    weightKg: weightCentiKg / 100,
    spreadG,
    rawCounts,
  };
}

function textToDataView(s: string): DataView {
  const bytes = new TextEncoder().encode(s);
  const dv = new DataView(new ArrayBuffer(bytes.length));
  bytes.forEach((b, i) => dv.setUint8(i, b));
  return dv;
}

function timeToDataView(epochSec: number, tzOffsetMin: number): DataView {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setUint32(0, epochSec >>> 0, true);   // little-endian
  dv.setInt16(4, tzOffsetMin, true);
  // bytes 6-7 reserved / zero
  return dv;
}

/**
 * Connect to a scale during its pairing window and push name and/or time.
 * Always disconnects afterwards. Throws a readable error if the window is
 * closed (the scale only accepts connections for ~60 s after boot/wake).
 */
export async function configureDevice(
  deviceId: string,
  opts: { name?: string; pushTime?: boolean; tzOffsetMin?: number },
): Promise<void> {
  await ensureInit();
  await withTimeout(
    BleClient.connect(deviceId, (id) => {
      // onDisconnect — nothing to do; surfaced via the action result.
      void id;
    }),
    15000,
    'Connect to scale',
  );
  try {
    if (opts.pushTime) {
      const tz = opts.tzOffsetMin ?? -new Date().getTimezoneOffset();
      const epochSec = Math.floor(Date.now() / 1000);
      await withTimeout(
        BleClient.write(deviceId, OA_CONFIG_SERVICE, OA_CHAR_TIME, timeToDataView(epochSec, tz)),
        8000,
        'Write time',
      );
    }
    if (opts.name != null) {
      const trimmed = opts.name.slice(0, 16);
      await withTimeout(
        BleClient.write(deviceId, OA_CONFIG_SERVICE, OA_CHAR_NAME, textToDataView(trimmed)),
        8000,
        'Write name',
      );
    }
  } finally {
    try { await BleClient.disconnect(deviceId); } catch { /* already gone */ }
  }
}

/**
 * Open a connection to the scale and keep it open. Use with the *Connected
 * helpers below to run several operations in one session, then call
 * disconnectDevice(). The firmware holds the link open for a couple of minutes.
 */
export async function connectDevice(deviceId: string): Promise<void> {
  await ensureInit();
  await withTimeout(
    BleClient.connect(deviceId, () => undefined),
    15000,
    'Connect to scale',
  );
}

export async function disconnectDevice(deviceId: string): Promise<void> {
  try { await BleClient.disconnect(deviceId); } catch { /* already gone */ }
}

/** Write the tare command on an already-open connection. */
export async function tareConnected(deviceId: string): Promise<void> {
  await withTimeout(
    BleClient.write(deviceId, OA_CONFIG_SERVICE, OA_CHAR_TARE, oneByte(1)),
    8000,
    'Write tare command',
  );
}

/** Push a new scale factor (computed app-side from a known-weight delta) to an
 * already-open connection. Works for both empty-bench and hive-in-field flows. */
export async function setFactorConnected(deviceId: string, factor: number): Promise<void> {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, factor, true); // little-endian to match firmware memcpy
  await withTimeout(
    BleClient.write(deviceId, OA_CONFIG_SERVICE, OA_CHAR_CALIB, dv),
    8000,
    'Write calibration',
  );
}

/** Request + read a diagnostics sample on an already-open connection. */
export async function readDiagnosticsConnected(deviceId: string): Promise<OADiagnostics> {
  await withTimeout(
    BleClient.write(deviceId, OA_CONFIG_SERVICE, OA_CHAR_SAMPLE, oneByte(1)),
    8000,
    'Request diagnostics sample',
  );
  // The firmware wakes the load cell and takes a median sample (~1s+). The
  // characteristic starts as a status=1 placeholder, so poll until valid.
  const deadline = Date.now() + 6000;
  let lastSample: DataView | null = null;
  await new Promise((r) => setTimeout(r, 300));
  while (Date.now() < deadline) {
    const sample = await withTimeout(
      BleClient.read(deviceId, OA_CONFIG_SERVICE, OA_CHAR_SAMPLE),
      8000,
      'Read diagnostics sample',
    );
    const b = new Uint8Array(sample.buffer, sample.byteOffset, sample.byteLength);
    if (b.length >= 1 && b[0] === 0) return parseDiagnostics(sample);
    lastSample = sample;
    await new Promise((r) => setTimeout(r, 300));
  }
  if (lastSample) return parseDiagnostics(lastSample); // surfaces the scale's error
  throw new Error('No diagnostics received from the scale.');
}

/**
 * One-shot tare (connect + tare + disconnect).
 * Prefer the session primitives when doing several steps back-to-back.
 */
export async function tareDevice(deviceId: string): Promise<void> {
  await connectDevice(deviceId);
  try {
    await tareConnected(deviceId);
  } finally {
    await disconnectDevice(deviceId);
  }
}

/**
 * One-shot diagnostics sample (connect + read + disconnect).
 */
export async function readDeviceDiagnostics(deviceId: string): Promise<OADiagnostics> {
  await connectDevice(deviceId);
  try {
    return await readDiagnosticsConnected(deviceId);
  } finally {
    await disconnectDevice(deviceId);
  }
}

/**
 * Briefly scan to resolve the live BLE deviceId for a known scale name
 * (e.g. "OA-ABCB"). Resolves null if the scale isn't heard within `ms`
 * (asleep / out of range). Used before a rename so we can connect to it.
 */
export async function findDeviceId(deviceName: string, ms = 6000): Promise<string | null> {
  await ensureInit();
  const wanted = deviceName.toLowerCase();
  return new Promise<string | null>((resolve) => {
    let done = false;
    const finish = (id: string | null) => {
      if (done) return;
      done = true;
      void BleClient.stopLEScan().catch(() => undefined);
      resolve(id);
    };
    const timer = setTimeout(() => finish(null), ms);
    BleClient.requestLEScan(
      { services: [BTHOME_SERVICE_UUID_128], allowDuplicates: false },
      (result) => {
        const name = (result.localName ?? result.device.name ?? '').toLowerCase();
        if (name === wanted) {
          clearTimeout(timer);
          finish(result.device.deviceId);
        }
      },
    ).catch(() => { clearTimeout(timer); finish(null); });
  });
}

/**
 * Briefly scan for a single BTHome advert from a named scale and return the
 * parsed reading (which includes `fwVersion`). Resolves null if not heard
 * within `ms`. Used by the Firmware page to show the installed version.
 */
export async function readAdvertOnce(deviceName: string, ms = 6000): Promise<OAAdvert | null> {
  await ensureInit();
  const wanted = deviceName.toLowerCase();
  return new Promise<OAAdvert | null>((resolve) => {
    let done = false;
    const finish = (a: OAAdvert | null) => {
      if (done) return;
      done = true;
      void BleClient.stopLEScan().catch(() => undefined);
      resolve(a);
    };
    const timer = setTimeout(() => finish(null), ms);
    BleClient.requestLEScan(
      { services: [BTHOME_SERVICE_UUID_128], allowDuplicates: true },
      (result) => {
        const name = result.localName ?? result.device.name ?? '';
        if (name.toLowerCase() !== wanted) return;
        const payload = extractServiceData(result);
        if (!payload) return;
        const reading = parseBTHome(payload);
        if (!reading) return;
        clearTimeout(timer);
        finish({
          ...reading,
          deviceId: result.device.deviceId,
          deviceName: name,
          rssi: result.rssi ?? 0,
          ts: Date.now(),
        });
      },
    ).catch(() => { clearTimeout(timer); finish(null); });
  });
}
