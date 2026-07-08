// Nordic Secure DFU over BLE — pure TypeScript on top of the app's existing
// @capacitor-community/bluetooth-le stack (one codepath for iOS / Android; the
// web build falls back to a simulation in ota.ts).
//
// This drives the same Secure DFU protocol Nordic's official mobile libraries
// use, against the Adafruit nRF52 bootloader's DFU service (0xFE59). The
// anti-brick guarantee comes from the bootloader itself: it validates the
// signed init packet before activating an image and, if a transfer is
// interrupted, stays in DFU mode (advertising "DfuTarg") so we can simply
// reconnect and retry — it never boots a partial/invalid image.
//
// Flow:
//   1. Buttonless trigger: connect during the scale's pairing window and write
//      0x01 to the buttonless DFU characteristic -> the scale reboots into the
//      bootloader and advertises the DFU service.
//   2. Reconnect to that bootloader advertiser (DfuTarg).
//   3. Transfer the init packet (.dat) then the firmware image (.bin) as CRC-
//      validated objects, then execute. The bootloader verifies + swaps.

import { BleClient } from '@capacitor-community/bluetooth-le';

// --- UUIDs (Nordic Secure DFU) ---
export const DFU_SERVICE = '0000fe59-0000-1000-8000-00805f9b34fb';
const DFU_CONTROL = '8ec90001-f315-4f60-9fb8-838830daea50';
const DFU_PACKET = '8ec90002-f315-4f60-9fb8-838830daea50';
// Buttonless DFU (without bonds) — lives under 0xFE59 while the app is running.
const DFU_BUTTONLESS = '8ec90003-f315-4f60-9fb8-838830daea50';

// --- Control point opcodes ---
const OP_CREATE = 0x01;
const OP_SET_PRN = 0x02;
const OP_CALC_CRC = 0x03;
const OP_EXECUTE = 0x04;
const OP_SELECT = 0x06;
const OP_RESPONSE = 0x60;
const RES_SUCCESS = 0x01;

const OBJ_COMMAND = 0x01; // init packet (.dat)
const OBJ_DATA = 0x02; // firmware image (.bin)

// Conservative packet chunk (min-MTU safe). Larger MTUs would go faster but the
// plugin doesn't expose MTU negotiation on all platforms; correctness first.
const PACKET_CHUNK = 20;

export interface DfuInput {
  initPacket: Uint8Array; // the .dat from the DFU .zip (signed init packet)
  firmware: Uint8Array; // the .bin from the DFU .zip
}

export type DfuProgress = (pct: number, phase: string) => void;

// --- CRC32 (IEEE / zlib) — Nordic Secure DFU uses this over transferred bytes ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(prev: number, bytes: Uint8Array): number {
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toDataView(bytes: Uint8Array): DataView {
  const dv = new DataView(new ArrayBuffer(bytes.length));
  bytes.forEach((b, i) => dv.setUint8(i, b));
  return dv;
}

/**
 * A single-in-flight request/response wrapper for the DFU control point.
 * We run with PRN disabled, so every control-point write yields exactly one
 * response notification — a single pending resolver is sufficient.
 */
class ControlPoint {
  private pending: ((dv: DataView) => void) | null = null;
  private failPending: ((e: Error) => void) | null = null;

  constructor(private deviceId: string) {}

  async start(): Promise<void> {
    await BleClient.startNotifications(this.deviceId, DFU_SERVICE, DFU_CONTROL, (value) => {
      const p = this.pending;
      this.pending = null;
      this.failPending = null;
      if (p) p(value);
    });
  }

  async stop(): Promise<void> {
    try {
      await BleClient.stopNotifications(this.deviceId, DFU_SERVICE, DFU_CONTROL);
    } catch {
      /* ignore */
    }
  }

  /** Write a command and wait for its response notification. */
  async command(bytes: number[], timeoutMs = 15000): Promise<DataView> {
    const wait = new Promise<DataView>((resolve, reject) => {
      this.pending = resolve;
      this.failPending = reject;
    });
    await BleClient.write(this.deviceId, DFU_SERVICE, DFU_CONTROL, toDataView(new Uint8Array(bytes)));
    const timer = new Promise<DataView>((_, reject) =>
      setTimeout(() => reject(new Error('DFU control point timed out')), timeoutMs),
    );
    const dv = await Promise.race([wait, timer]);
    // Response layout: [0x60, reqOpcode, resultCode, ...payload]
    if (dv.getUint8(0) !== OP_RESPONSE) throw new Error('DFU: malformed response');
    if (dv.getUint8(2) !== RES_SUCCESS) {
      throw new Error(`DFU rejected (op 0x${dv.getUint8(1).toString(16)}, result ${dv.getUint8(2)})`);
    }
    return dv;
  }
}

interface SelectResult {
  maxSize: number;
  offset: number;
  crc: number;
}

function parseSelect(dv: DataView): SelectResult {
  // [0x60, 0x06, 0x01, maxSize(4 LE), offset(4 LE), crc(4 LE)]
  return {
    maxSize: dv.getUint32(3, true),
    offset: dv.getUint32(7, true),
    crc: dv.getUint32(11, true),
  };
}

async function writePacketBytes(deviceId: string, bytes: Uint8Array): Promise<void> {
  for (let off = 0; off < bytes.length; off += PACKET_CHUNK) {
    const chunk = bytes.subarray(off, Math.min(off + PACKET_CHUNK, bytes.length));
    await BleClient.writeWithoutResponse(deviceId, DFU_SERVICE, DFU_PACKET, toDataView(chunk));
  }
}

/** Transfer the init packet (command object). Small enough for a single object. */
async function transferInitPacket(cp: ControlPoint, deviceId: string, dat: Uint8Array): Promise<void> {
  const sel = parseSelect(await cp.command([OP_SELECT, OBJ_COMMAND]));
  if (dat.length > sel.maxSize) throw new Error('DFU: init packet larger than command object');
  await cp.command([OP_SET_PRN, 0x00, 0x00]); // disable packet receipt notifications
  await cp.command([
    OP_CREATE,
    OBJ_COMMAND,
    dat.length & 0xff,
    (dat.length >> 8) & 0xff,
    (dat.length >> 16) & 0xff,
    (dat.length >> 24) & 0xff,
  ]);
  await writePacketBytes(deviceId, dat);
  const crcDv = await cp.command([OP_CALC_CRC]);
  const gotCrc = crcDv.getUint32(7, true);
  if (gotCrc !== crc32(0, dat)) throw new Error('DFU: init packet CRC mismatch');
  await cp.command([OP_EXECUTE]);
}

/** Transfer the firmware image (data objects), reporting progress 0..100. */
async function transferFirmware(
  cp: ControlPoint,
  deviceId: string,
  bin: Uint8Array,
  onProgress: DfuProgress,
): Promise<void> {
  const sel = parseSelect(await cp.command([OP_SELECT, OBJ_DATA]));
  const objSize = sel.maxSize; // e.g. 4096
  await cp.command([OP_SET_PRN, 0x00, 0x00]); // CRC checked after each object

  let sent = 0;
  let runningCrc = 0;
  while (sent < bin.length) {
    const len = Math.min(objSize, bin.length - sent);
    const obj = bin.subarray(sent, sent + len);

    await cp.command([
      OP_CREATE,
      OBJ_DATA,
      len & 0xff,
      (len >> 8) & 0xff,
      (len >> 16) & 0xff,
      (len >> 24) & 0xff,
    ]);
    await writePacketBytes(deviceId, obj);
    runningCrc = crc32(runningCrc, obj);

    const crcDv = await cp.command([OP_CALC_CRC]);
    const gotOffset = crcDv.getUint32(3, true);
    const gotCrc = crcDv.getUint32(7, true);
    if (gotOffset !== sent + len || gotCrc !== runningCrc) {
      throw new Error('DFU: firmware object CRC mismatch');
    }
    await cp.command([OP_EXECUTE]);

    sent += len;
    onProgress(Math.round((sent / bin.length) * 100), 'Uploading');
  }
}

/**
 * Trigger buttonless DFU on a scale that is currently in its pairing window.
 * The scale acknowledges, disconnects, and reboots into the bootloader.
 *
 * Robustness: iOS caches a peripheral's GATT table and can serve a STALE copy
 * captured when the scale ran older firmware that didn't expose the buttonless
 * DFU characteristic — which surfaces as "Characteristic not found" even though
 * the running firmware has it. We defeat that by forcing a fresh service
 * discovery and confirming the characteristic is really present before using
 * it, retrying with a full reconnect a few times.
 */
/** Force a fresh discovery, then report whether service+characteristic exist. */
async function hasCharacteristic(
  deviceId: string,
  service: string,
  characteristic: string,
): Promise<{ present: boolean; serviceUuids: string[] }> {
  try {
    // On iOS/Android this re-reads the peripheral's GATT rather than trusting
    // the OS cache (no-op / unsupported on web, which we never hit here).
    await BleClient.discoverServices(deviceId);
  } catch {
    /* fall through to getServices */
  }
  let services: { uuid: string; characteristics: { uuid: string }[] }[] = [];
  try {
    services = await BleClient.getServices(deviceId);
  } catch {
    return { present: false, serviceUuids: [] };
  }
  const serviceUuids = services.map((s) => s.uuid.toLowerCase());
  const svc = services.find((s) => s.uuid.toLowerCase() === service.toLowerCase());
  const present = !!svc && svc.characteristics.some(
    (c) => c.uuid.toLowerCase() === characteristic.toLowerCase(),
  );
  return { present, serviceUuids };
}

export async function triggerButtonlessDfu(deviceId: string): Promise<void> {
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  let sawDfuService = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await BleClient.connect(deviceId, () => undefined);
    } catch (e) {
      lastErr = e;
      await sleep(700);
      continue;
    }

    try {
      const { present, serviceUuids } = await hasCharacteristic(
        deviceId, DFU_SERVICE, DFU_BUTTONLESS,
      );
      if (serviceUuids.includes(DFU_SERVICE.toLowerCase())) sawDfuService = true;

      if (!present) {
        // Not visible yet — drop the link and retry; a reconnect + re-discovery
        // often clears a transient/stale view.
        await BleClient.disconnect(deviceId).catch(() => undefined);
        lastErr = new Error('buttonless-dfu-missing');
        await sleep(700);
        continue;
      }

      let acked = false;
      await BleClient.startNotifications(deviceId, DFU_SERVICE, DFU_BUTTONLESS, (dv) => {
        // [0x20, 0x01, 0x01] = response, enter-bootloader, success
        if (dv.getUint8(0) === 0x20 && dv.getUint8(2) === 0x01) acked = true;
      });
      await BleClient.write(deviceId, DFU_SERVICE, DFU_BUTTONLESS, toDataView(new Uint8Array([0x01])));
      // The device disconnects almost immediately; give it a beat to ack + reboot.
      for (let i = 0; i < 20 && !acked; i++) await sleep(100);
      try { await BleClient.disconnect(deviceId); } catch { /* rebooting */ }
      return; // success
    } catch (e) {
      lastErr = e;
      try { await BleClient.disconnect(deviceId); } catch { /* already gone */ }
      await sleep(700);
    }
  }

  if (lastErr instanceof Error && lastErr.message === 'buttonless-dfu-missing') {
    throw new Error(
      sawDfuService
        ? "The scale's update service is visible but the update trigger isn't responding. Move closer, keep the app open, and try again."
        : "Your phone has a stale Bluetooth cache for this scale and can't see its update service. Turn the phone's Bluetooth fully off and on (or restart the phone), then try again.",
    );
  }
  throw new Error(
    `Couldn't start the update over Bluetooth${lastErr instanceof Error ? `: ${lastErr.message}` : ''}. Keep the phone close and try again.`,
  );
}

/**
 * Scan for the bootloader advertiser (DfuTarg — advertises the 0xFE59 service)
 * after a buttonless trigger, and return its live BLE deviceId.
 */
export async function findBootloader(timeoutMs = 20000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let done = false;
    let best: { id: string; rssi: number } | null = null;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      void BleClient.stopLEScan().catch(() => undefined);
      if (err) reject(err);
      else if (best) resolve(best.id);
      else reject(new Error('Bootloader not found — the scale did not enter DFU mode'));
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    BleClient.requestLEScan({ services: [DFU_SERVICE], allowDuplicates: true }, (result) => {
      const rssi = result.rssi ?? -999;
      const name = result.localName ?? result.device.name ?? '';
      // Prefer a "DfuTarg" by name; otherwise strongest FE59 advertiser.
      const isDfu = name.toLowerCase().includes('dfu') || true;
      if (isDfu && (!best || rssi > best.rssi)) best = { id: result.device.deviceId, rssi };
      // Resolve quickly once we have a strong candidate.
      if (best && best.rssi > -60) {
        clearTimeout(timer);
        finish();
      }
    }).catch((e) => {
      clearTimeout(timer);
      finish(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

/**
 * Run the Secure DFU byte transfer against a bootloader deviceId. Retries the
 * connection a few times because the DfuTarg advert can take a moment to appear
 * and the first connect after a reboot occasionally races the stack.
 */
export async function runSecureDfu(
  bootloaderId: string,
  input: DfuInput,
  onProgress: DfuProgress,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await BleClient.connect(bootloaderId, () => undefined);
      // Force a fresh discovery so we never act on a stale cached GATT table.
      try { await BleClient.discoverServices(bootloaderId); } catch { /* best effort */ }
      const cp = new ControlPoint(bootloaderId);
      try {
        await cp.start();
        onProgress(0, 'Preparing');
        await transferInitPacket(cp, bootloaderId, input.initPacket);
        await transferFirmware(cp, bootloaderId, input.firmware, onProgress);
        onProgress(100, 'Verifying');
      } finally {
        await cp.stop();
        try {
          await BleClient.disconnect(bootloaderId);
        } catch {
          /* bootloader reboots into the new app on success */
        }
      }
      return;
    } catch (e) {
      lastErr = e;
      await sleep(800);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
