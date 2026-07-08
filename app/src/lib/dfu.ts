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
const OP_PRN_REQUEST = 0x08;
const OP_RESPONSE = 0x10;
const OP_RECEIPT = 0x11;
const RES_SUCCESS = 0x01;

const IMG_APPLICATION = 0x04; // START_DFU image type: application only

// BLE min-MTU-safe packet chunk. The plugin has no packet-receipt flow control
// of its own, so we use the DFU protocol's packet-receipt notifications (PRN)
// to pace the stream instead.
const PACKET_CHUNK = 20;
const PRN_INTERVAL = 12; // request a receipt every N packets (~240 bytes)

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
 * notification on the control point:
 *   - RESPONSE (0x10): [0x10, reqOpcode, resultCode, ...]
 *   - RECEIPT  (0x11): [0x11, bytesReceived(uint32 LE)]  (packet-receipt flow ctl)
 */
class DfuControl {
  private respResolve: ((dv: DataView) => void) | null = null;
  private receiptResolve: ((dv: DataView) => void) | null = null;

  constructor(private deviceId: string) {}

  async start(): Promise<void> {
    await BleClient.startNotifications(this.deviceId, DFU_SERVICE, DFU_CONTROL, (dv) => {
      const op = dv.getUint8(0);
      if (op === OP_RESPONSE) {
        const r = this.respResolve; this.respResolve = null; if (r) r(dv);
      } else if (op === OP_RECEIPT) {
        const r = this.receiptResolve; this.receiptResolve = null; if (r) r(dv);
      }
    });
  }

  async stop(): Promise<void> {
    try { await BleClient.stopNotifications(this.deviceId, DFU_SERVICE, DFU_CONTROL); } catch { /* ignore */ }
  }

  /** Arm a response waiter BEFORE the write that will trigger it. */
  armResponse(timeoutMs = 20000): Promise<DataView> {
    return new Promise<DataView>((resolve, reject) => {
      this.respResolve = resolve;
      setTimeout(() => {
        if (this.respResolve === resolve) { this.respResolve = null; reject(new Error('DFU control point timed out')); }
      }, timeoutMs);
    });
  }

  /** Arm a packet-receipt waiter BEFORE sending the packets it acknowledges. */
  armReceipt(timeoutMs = 20000): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.receiptResolve = (dv) => resolve(dv.getUint32(1, true));
      setTimeout(() => {
        if (this.receiptResolve) { this.receiptResolve = null; reject(new Error('DFU packet receipt timed out')); }
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
 * Run the legacy DFU byte transfer against a bootloader deviceId. Retries the
 * connection a few times because the bootloader advert can take a moment to
 * appear and the first connect after a reboot occasionally races the stack.
 */
export async function runLegacyDfu(
  bootloaderId: string,
  input: DfuInput,
  onProgress: DfuProgress,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await BleClient.connect(bootloaderId, () => undefined, { timeout: 12000 });
      try { await BleClient.discoverServices(bootloaderId); } catch { /* best effort */ }
      const ctl = new DfuControl(bootloaderId);
      try {
        await ctl.start();
        onProgress(0, 'Preparing');

        // 1. START_DFU (application) + image sizes [sd=0, bl=0, app=len].
        let resp = ctl.armResponse();
        await ctl.writeControl([OP_START_DFU, IMG_APPLICATION]);
        const sizes = new Uint8Array(12);
        sizes.set(u32le(0), 0);                     // softdevice size
        sizes.set(u32le(0), 4);                     // bootloader size
        sizes.set(u32le(input.firmware.length), 8); // application size
        await ctl.writePacket(sizes);
        checkResponse(await resp, OP_START_DFU);

        // 2. Init packet (.dat): begin -> stream -> complete.
        onProgress(0, 'Sending init packet');
        await ctl.writeControl([OP_INIT_DFU, 0x00]); // receive init packet
        await ctl.writePacket(input.initPacket);
        resp = ctl.armResponse();
        await ctl.writeControl([OP_INIT_DFU, 0x01]); // init packet complete
        checkResponse(await resp, OP_INIT_DFU);

        // 3. Configure packet-receipt notifications for flow control.
        await ctl.writeControl([OP_PRN_REQUEST, PRN_INTERVAL & 0xff, (PRN_INTERVAL >> 8) & 0xff]);

        // 4. Receive firmware image with PRN pacing.
        onProgress(0, 'Uploading');
        const bin = input.firmware;
        const total = bin.length;
        resp = ctl.armResponse(60000); // completion arrives after the last packet
        await ctl.writeControl([OP_RECEIVE_IMAGE]);

        let sent = 0;
        let packetsSinceReceipt = 0;
        while (sent < total) {
          let receipt: Promise<number> | null = null;
          // Send up to PRN_INTERVAL packets, then wait for a receipt (unless we
          // finished the image, in which case the completion response follows).
          while (packetsSinceReceipt < PRN_INTERVAL && sent < total) {
            const len = Math.min(PACKET_CHUNK, total - sent);
            if (packetsSinceReceipt === PRN_INTERVAL - 1 && sent + len < total) {
              receipt = ctl.armReceipt(); // arm before the packet that triggers it
            }
            await BleClient.writeWithoutResponse(
              bootloaderId, DFU_SERVICE, DFU_PACKET, toDataView(bin.subarray(sent, sent + len)),
            );
            sent += len;
            packetsSinceReceipt++;
          }
          if (receipt) {
            const ack = await receipt;
            if (ack !== sent) throw new Error(`DFU: receipt offset mismatch (${ack} vs ${sent})`);
            packetsSinceReceipt = 0;
          }
          onProgress(Math.round((sent / total) * 100), 'Uploading');
        }

        checkResponse(await resp, OP_RECEIVE_IMAGE);

        // 5. Validate, then activate & reset (device reboots into the new app).
        onProgress(100, 'Verifying');
        resp = ctl.armResponse();
        await ctl.writeControl([OP_VALIDATE]);
        checkResponse(await resp, OP_VALIDATE);

        onProgress(100, 'Activating');
        try { await ctl.writeControl([OP_ACTIVATE_RESET]); } catch { /* reboots, no response */ }
      } finally {
        await ctl.stop();
        try { await BleClient.disconnect(bootloaderId); } catch { /* bootloader reboots into new app */ }
      }
      return;
    } catch (e) {
      lastErr = e;
      await sleep(800);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('DFU transfer failed.');
}
