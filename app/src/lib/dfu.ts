// OTA firmware over BLE — LEGACY Nordic DFU (Adafruit nRF52 bootloader).
//
// IMPORTANT: The XIAO nRF52840 runs the Adafruit bootloader, whose BLEDfu
// service is the *legacy* Nordic DFU (SDK 11, dfu_version 0.5), NOT Secure DFU.
//   DFU Service : 00001530-1212-EFDE-1523-785FEABCD123
//   DFU Control : 00001531-1212-EFDE-1523-785FEABCD123  (write + notify)
//   DFU Packet  : 00001532-1212-EFDE-1523-785FEABCD123  (write without response)
// The DFU distribution .zip carries firmware.bin + firmware.dat (init packet)
// with a manifest whose dfu_version is 0.5 — the classic legacy format.
//
// Buttonless entry (from the running app firmware, same 00001530 service):
//   1. Enable notifications on the control point (the firmware REJECTS the
//      trigger with a CCCD error if notifications aren't enabled first).
//   2. Write 0x01 (START_DFU) to the control point. The scale saves peer data,
//      disconnects, sets the DFU magic in GPREGRET and reboots into the
//      bootloader, which then advertises the 00001530 service for reconnect.
//
// Transfer (in the bootloader) — classic SDK 11 sequence:
//   START_DFU(app) -> sizes -> INIT params(.dat) -> RECEIVE_IMAGE(.bin, with
//   packet-receipt flow control) -> VALIDATE -> ACTIVATE_AND_RESET.
//
// Anti-brick: the bootloader validates the CRC in the init packet and only
// activates a fully received image; an interrupted transfer leaves it waiting
// in DFU mode, so we simply reconnect and retry — it never boots a bad image.

import { BleClient } from '@capacitor-community/bluetooth-le';

// --- UUIDs (legacy Nordic DFU / Adafruit BLEDfu) ---
export const DFU_SERVICE = '00001530-1212-efde-1523-785feabcd123';
const DFU_CONTROL = '00001531-1212-efde-1523-785feabcd123';
const DFU_PACKET = '00001532-1212-efde-1523-785feabcd123';

// --- Control point opcodes (SDK 11 legacy) ---
const OP_START_DFU = 0x01;
const OP_INIT_DFU = 0x02;
const OP_RECEIVE_IMAGE = 0x03;
const OP_VALIDATE = 0x04;
const OP_ACTIVATE_RESET = 0x05;
const OP_SYS_RESET = 0x06;
const OP_PRN_REQUEST = 0x08;
const OP_RESPONSE = 0x10;
const RES_SUCCESS = 0x01;
const RES_INVALID_STATE = 0x02;

const IMG_APPLICATION = 0x04; // START_DFU image type: application only

// BLE min-MTU-safe packet chunk. The bootloader receives firmware packets into a
// small fixed RX buffer pool (hci_mem_pool) and drains it as it writes flash;
// blasting too many packets before it drains overflows the pool and aborts with
// OPERATION_FAILED. We use the DFU protocol's packet-receipt notifications (PRN)
// as backpressure with a SMALL interval so we never outrun the pool.
const PACKET_CHUNK = 20;
const PRN_INTERVAL = 4; // wait for a receipt every N packets (~80 bytes)

export interface DfuInput {
  initPacket: Uint8Array; // firmware.dat (legacy init packet)
  firmware: Uint8Array; // firmware.bin
}

export type DfuProgress = (pct: number, phase: string) => void;

export type DfuTriggerCode = 'connect-failed' | 'service-missing' | 'char-missing' | 'trigger-failed';

export class DfuTriggerError extends Error {
  constructor(public code: DfuTriggerCode, message: string) {
    super(message);
    this.name = 'DfuTriggerError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toDataView(bytes: Uint8Array): DataView {
  const dv = new DataView(new ArrayBuffer(bytes.length));
  bytes.forEach((b, i) => dv.setUint8(i, b));
  return dv;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

/** Force a fresh discovery, then report whether service+characteristic exist. */
async function hasCharacteristic(
  deviceId: string,
  service: string,
  characteristic: string,
): Promise<{ present: boolean; serviceUuids: string[] }> {
  try {
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

/**
 * Trigger buttonless DFU. The scale is only *connectable* for a few seconds per
 * heartbeat, so the caller (ota.ts) re-scans and retries this across heartbeat
 * windows. Single controlled attempt:
 *   connect (bounded) -> verify the legacy DFU control characteristic exists
 *   -> enable notifications (required) -> write START_DFU (0x01).
 * Throws a typed DfuTriggerError so the caller can decide whether to retry.
 */
export async function triggerButtonlessDfu(deviceId: string): Promise<void> {
  try {
    await BleClient.connect(deviceId, () => undefined, { timeout: 9000 });
  } catch (e) {
    throw new DfuTriggerError(
      'connect-failed',
      `connect failed${e instanceof Error ? `: ${e.message}` : ''}`,
    );
  }

  try {
    const { present, serviceUuids } = await hasCharacteristic(deviceId, DFU_SERVICE, DFU_CONTROL);
    if (!present) {
      const hasService = serviceUuids.includes(DFU_SERVICE.toLowerCase());
      throw new DfuTriggerError(
        hasService ? 'char-missing' : 'service-missing',
        hasService ? 'DFU control characteristic missing' : 'DFU service not visible',
      );
    }

    // The firmware's control-point write-authorize callback rejects the trigger
    // unless notifications (CCCD) are enabled — so subscribe first.
    await BleClient.startNotifications(deviceId, DFU_SERVICE, DFU_CONTROL, () => undefined);
    // Write START_DFU. The scale disconnects + reboots immediately, so the write
    // may reject with a disconnection error — that's the expected success path.
    try {
      await BleClient.write(deviceId, DFU_SERVICE, DFU_CONTROL, toDataView(new Uint8Array([OP_START_DFU])));
    } catch {
      /* disconnect race as the scale reboots into the bootloader */
    }
    await sleep(400);
  } catch (e) {
    if (e instanceof DfuTriggerError) throw e;
    throw new DfuTriggerError('trigger-failed', e instanceof Error ? e.message : String(e));
  } finally {
    try { await BleClient.disconnect(deviceId); } catch { /* the scale reboots */ }
  }
}

/**
 * Scan for the bootloader advertiser after a buttonless trigger (it advertises
 * the legacy DFU service) and return its live BLE deviceId.
 */
export async function findBootloader(timeoutMs = 25000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let done = false;
    let best: { id: string; rssi: number } | null = null;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      void BleClient.stopLEScan().catch(() => undefined);
      if (err) reject(err);
      else if (best) resolve(best.id);
      else reject(new Error('Bootloader not found — the scale did not enter update mode.'));
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    BleClient.requestLEScan({ services: [DFU_SERVICE], allowDuplicates: true }, (result) => {
      const rssi = result.rssi ?? -999;
      if (!best || rssi > best.rssi) best = { id: result.device.deviceId, rssi };
      if (best && best.rssi > -55) {
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
 * Control-point notification router. The legacy bootloader sends two kinds of
 * notification on the control point, both of which we surface through a single
 * "next notification" waiter:
 *   - RESPONSE (0x10): [0x10, reqOpcode, resultCode, ...]
 *   - RECEIPT  (0x11): [0x11, bytesReceived(uint32 LE)]  (packet-receipt flow ctl)
 */
class DfuControl {
  private resolver: ((dv: DataView) => void) | null = null;

  constructor(private deviceId: string) {}

  async start(): Promise<void> {
    await BleClient.startNotifications(this.deviceId, DFU_SERVICE, DFU_CONTROL, (dv) => {
      const r = this.resolver; this.resolver = null; if (r) r(dv);
    });
  }

  async stop(): Promise<void> {
    try { await BleClient.stopNotifications(this.deviceId, DFU_SERVICE, DFU_CONTROL); } catch { /* ignore */ }
  }

  /**
   * Arm a waiter for the NEXT control-point notification (response or receipt).
   * MUST be called BEFORE the write that will trigger it, so we never miss a
   * fast notification.
   */
  armNext(timeoutMs = 20000): Promise<DataView> {
    return new Promise<DataView>((resolve, reject) => {
      this.resolver = resolve;
      setTimeout(() => {
        if (this.resolver === resolve) { this.resolver = null; reject(new Error('DFU control point timed out')); }
      }, timeoutMs);
    });
  }

  writeControl(bytes: number[]): Promise<void> {
    return BleClient.write(this.deviceId, DFU_SERVICE, DFU_CONTROL, toDataView(new Uint8Array(bytes)));
  }

  async writePacket(bytes: Uint8Array): Promise<void> {
    for (let off = 0; off < bytes.length; off += PACKET_CHUNK) {
      const chunk = bytes.subarray(off, Math.min(off + PACKET_CHUNK, bytes.length));
      await BleClient.writeWithoutResponse(this.deviceId, DFU_SERVICE, DFU_PACKET, toDataView(chunk));
    }
  }
}

function checkResponse(dv: DataView, expectedOp: number): void {
  // [0x10, reqOpcode, resultCode, ...]
  if (dv.getUint8(0) !== OP_RESPONSE) throw new Error('DFU: malformed response');
  if (dv.getUint8(1) !== expectedOp) throw new Error(`DFU: response for wrong op (got 0x${dv.getUint8(1).toString(16)})`);
  if (dv.getUint8(2) !== RES_SUCCESS) throw new Error(`DFU rejected (op 0x${expectedOp.toString(16)}, result ${dv.getUint8(2)})`);
}

/**
 * Run the legacy DFU byte transfer against a bootloader deviceId. The initial
 * CONNECT is retried (the post-reboot advert can race the stack), but the
 * transfer itself is a single pass: retrying a partial transfer would hit the
 * bootloader mid-session and get INVALID_STATE, so instead we surface a clear
 * error and (when stuck) reset the bootloader so the next attempt starts clean.
 */
export async function runLegacyDfu(
  bootloaderId: string,
  input: DfuInput,
  onProgress: DfuProgress,
): Promise<void> {
  // Connect with a few retries for the post-reboot advertising race.
  let connected = false;
  let lastErr: unknown;
  for (let c = 0; c < 4 && !connected; c++) {
    try {
      await BleClient.connect(bootloaderId, () => undefined, { timeout: 12000 });
      try { await BleClient.discoverServices(bootloaderId); } catch { /* best effort */ }
      connected = true;
    } catch (e) {
      lastErr = e;
      await sleep(800);
    }
  }
  if (!connected) {
    throw lastErr instanceof Error ? lastErr : new Error('Could not connect to the updater.');
  }

  const ctl = new DfuControl(bootloaderId);
  try {
    await ctl.start();
    onProgress(0, 'Preparing');

    const bin = input.firmware;
    const total = bin.length;

    // Firmware-data packets stay at the min-MTU-safe 20 bytes. Larger packets
    // sized from the ATT MTU are NOT safe on iOS: CoreBluetooth silently drops
    // a writeWithoutResponse that exceeds its own per-write limit (often below
    // the reported ATT MTU), which stalls the transfer with no packet receipt.
    const dataChunk = PACKET_CHUNK;

    // 1. START_DFU (application) + image sizes [sd=0, bl=0, app=len]. The
    //    bootloader erases the target bank during this step and only replies
    //    once it's ready, so no separate erase wait is needed.
    let ev = ctl.armNext(30000);
    await ctl.writeControl([OP_START_DFU, IMG_APPLICATION]);
    const sizes = new Uint8Array(12);
    sizes.set(u32le(0), 0);
    sizes.set(u32le(0), 4);
    sizes.set(u32le(total), 8);
    await ctl.writePacket(sizes);
    const startResp = await ev;
    if (startResp.getUint8(0) === OP_RESPONSE && startResp.getUint8(2) === RES_INVALID_STATE) {
      // The bootloader is stuck mid-session from a previous partial attempt.
      // Reset it so it reboots clean; the next update starts fresh.
      try { await ctl.writeControl([OP_SYS_RESET]); } catch { /* reboots */ }
      throw new Error("The scale's updater was still busy from a previous attempt, so it has been reset. Wait ~20s for the scale to reappear, then tap Update again.");
    }
    checkResponse(startResp, OP_START_DFU);

    // 2. Init packet (.dat): begin -> stream -> complete.
    onProgress(0, 'Sending init packet');
    await ctl.writeControl([OP_INIT_DFU, 0x00]);
    await ctl.writePacket(input.initPacket);
    ev = ctl.armNext();
    await ctl.writeControl([OP_INIT_DFU, 0x01]);
    checkResponse(await ev, OP_INIT_DFU);

    // 3. Enable packet-receipt notifications (backpressure) and start receiving.
    await ctl.writeControl([OP_PRN_REQUEST, PRN_INTERVAL & 0xff, (PRN_INTERVAL >> 8) & 0xff]);
    await ctl.writeControl([OP_RECEIVE_IMAGE]);

    // 4. Stream the image, pausing every PRN_INTERVAL packets for a receipt so
    //    we never overrun the bootloader's RX buffer pool. An early error
    //    response is surfaced immediately.
    onProgress(0, 'Uploading');
    let sent = 0;
    let sinceReceipt = 0;
    let finalEv: Promise<DataView> | null = null;
    while (sent < total) {
      const len = Math.min(dataChunk, total - sent);
      const isLast = sent + len >= total;
      const atBatch = sinceReceipt + 1 >= PRN_INTERVAL && !isLast;
      let ev2: Promise<DataView> | null = null;
      if (isLast) finalEv = ctl.armNext(30000);
      else if (atBatch) ev2 = ctl.armNext(20000);

      await BleClient.writeWithoutResponse(
        bootloaderId, DFU_SERVICE, DFU_PACKET, toDataView(bin.subarray(sent, sent + len)),
      );
      sent += len;
      sinceReceipt++;

      if (ev2) {
        const dv = await ev2;
        if (dv.getUint8(0) === OP_RESPONSE) checkResponse(dv, OP_RECEIVE_IMAGE); // early abort
        sinceReceipt = 0;
      }
      onProgress(Math.round((sent / total) * 100), 'Uploading');
    }

    checkResponse(await (finalEv ?? ctl.armNext(30000)), OP_RECEIVE_IMAGE);

    // 5. Validate, then activate & reset (device reboots into the new app).
    onProgress(100, 'Verifying');
    ev = ctl.armNext();
    await ctl.writeControl([OP_VALIDATE]);
    checkResponse(await ev, OP_VALIDATE);

    onProgress(100, 'Activating');
    try { await ctl.writeControl([OP_ACTIVATE_RESET]); } catch { /* reboots, no response */ }
  } finally {
    await ctl.stop();
    try { await BleClient.disconnect(bootloaderId); } catch { /* bootloader reboots into new app */ }
  }
}
