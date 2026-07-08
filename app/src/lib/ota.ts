// OTA firmware over BLE (Nordic Secure DFU).
//
// The XIAO nRF52840 runs the Adafruit bootloader, which exposes Nordic
// buttonless Secure DFU; the firmware adds BLEDfu so the app can trigger an
// update during the scale's pairing window. This module:
//   1. fetches release metadata from the Worker (never GitHub directly),
//   2. downloads the DFU .zip through the Worker (authenticated),
//   3. checks the download's sha256 against the manifest (integrity),
//   4. unpacks the init packet (.dat) + image (.bin) and drives the DFU.
//
// Authenticity (the detached Ed25519 signature vs a pinned public key) is
// enforced by the Worker's /v1/firmware/download before any bytes are streamed
// — the key lives on our own Cloudflare infra, so a compromised GitHub/CDN/MITM
// cannot push a firmware image the scale would accept. The client sha256 check
// then guards the integrity of the bytes actually received.
//
// In browser dev (no BLE) we simulate progress so the flow stays reviewable.

import { Capacitor } from '@capacitor/core';
import { unzipSync } from 'fflate';
import { loadSettings } from './settings';
import { getLatestFirmware, downloadFirmwareBytes, type FirmwareInfo } from './api';
import { findDeviceId } from './ble';
import { triggerButtonlessDfu, findBootloader, runSecureDfu, type DfuProgress } from './dfu';

export type { FirmwareInfo } from './api';
export type { DfuProgress } from './dfu';

// Fallback "installed" version shown before we've heard a firmware-version advert
// from the scale. Keep in sync with firmware/src/version.h (OA_FW_VERSION_STRING).
export const CURRENT_BUILD = 'v1.0.1';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view to satisfy BufferSource typing.
  const buf = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Latest published firmware metadata (from the Worker, proxying the private release). */
export async function latestFirmware(): Promise<FirmwareInfo> {
  const s = await loadSettings();
  return getLatestFirmware(s);
}

/**
 * Verify the integrity of a downloaded DFU package: its sha256 must match the
 * manifest. Authenticity (the Ed25519 signature) is enforced by the Worker
 * before it streams the bytes. Throws if the checksum doesn't match.
 */
async function verifyPackage(zip: Uint8Array, latest: FirmwareInfo): Promise<void> {
  const m = latest.manifest?.zip;
  if (!m || !m.sha256) {
    throw new Error('Firmware manifest is missing a checksum — refusing to install.');
  }
  const gotSha = await sha256Hex(zip);
  if (gotSha !== m.sha256.trim().toLowerCase()) {
    throw new Error('Firmware checksum mismatch — download corrupted or tampered.');
  }
}

/** Unpack a Nordic DFU distribution .zip into its init packet (.dat) + image (.bin). */
function unpackDfuZip(zip: Uint8Array): { initPacket: Uint8Array; firmware: Uint8Array } {
  const files = unzipSync(zip);
  let datName: string | undefined;
  let binName: string | undefined;

  const man = files['manifest.json'];
  if (man) {
    try {
      const j = JSON.parse(new TextDecoder().decode(man));
      const app = j?.manifest?.application ?? j?.manifest?.softdevice ?? null;
      datName = app?.dat_file;
      binName = app?.bin_file;
    } catch {
      /* fall through to extension scan */
    }
  }
  if (!datName) datName = Object.keys(files).find((n) => n.endsWith('.dat'));
  if (!binName) binName = Object.keys(files).find((n) => n.endsWith('.bin'));
  if (!datName || !binName || !files[datName] || !files[binName]) {
    throw new Error('Firmware package is not a valid Nordic DFU archive.');
  }
  return { initPacket: files[datName], firmware: files[binName] };
}

/**
 * Push firmware to a scale during its pairing window.
 *
 * Preconditions (surfaced in the UI): the user has pressed the scale's button
 * to reboot it, so it is advertising connectably. We resolve its live BLE id,
 * trigger buttonless DFU, then transfer over the bootloader's DFU service. If
 * the transfer is interrupted the bootloader stays in DFU mode and the engine
 * reconnects/retries; the scale is never left with a partial image.
 */
export async function updateFirmware(
  deviceName: string,
  latest: FirmwareInfo,
  onProgress: DfuProgress,
): Promise<void> {
  // Browser dev: no BLE — simulate so the flow is testable.
  if (!Capacitor.isNativePlatform()) {
    for (let p = 0; p <= 100; p += 5) {
      await new Promise((r) => setTimeout(r, 120));
      onProgress(p, p < 100 ? 'Uploading' : 'Done');
    }
    return;
  }

  if (!latest.zip?.downloadUrl) throw new Error('No firmware package is available to install.');

  // 1. Download + verify BEFORE touching the scale.
  onProgress(0, 'Downloading');
  const s = await loadSettings();
  const zip = await downloadFirmwareBytes(s, latest.zip.downloadUrl);
  onProgress(0, 'Verifying');
  await verifyPackage(zip, latest);
  const pkg = unpackDfuZip(zip);

  // 2. Find the scale in its pairing window and trigger buttonless DFU.
  onProgress(0, 'Connecting');
  const deviceId = await findDeviceId(deviceName, 8000);
  if (!deviceId) {
    throw new Error('Scale not found. Press its button to reboot it, then try again within a minute.');
  }
  onProgress(0, 'Entering update mode');
  await triggerButtonlessDfu(deviceId);

  // 3. Reconnect to the bootloader and transfer.
  const bootloaderId = await findBootloader(20000);
  await runSecureDfu(bootloaderId, pkg, onProgress);
}
