// Tiny REST client for the OpenApiary Cloudflare Worker.

import type { Settings } from './settings';

export interface ReadingUpload {
  ts: number;
  weightKg?: number;
  batteryV?: number;
  tempC?: number;
  packetId?: number;
  rssi?: number;
}

export interface HiveSummary {
  id: string;
  name: string;
  created_at: number;
  public: number;
}

export interface HiveReading {
  ts: number;
  weight_kg: number | null;
  battery_v: number | null;
  temp_c: number | null;
  rssi: number | null;
  packet_id: number | null;
}

function headers(s: Settings): HeadersInit {
  return { 'X-API-Key': s.apiKey, 'Content-Type': 'application/json' };
}

export interface AccountResult {
  user_id: string;
  api_key: string;
  email: string | null;
}

/** Create a new account. Pass email+password for a full account, or neither for anonymous. */
export async function registerAccount(
  apiUrl: string,
  email?: string,
  password?: string,
): Promise<AccountResult> {
  const r = await fetch(`${apiUrl}/v1/account/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `register failed (${r.status})`);
  return j as AccountResult;
}

/** Log in with email + password; the server mints a fresh per-device key. */
export async function loginAccount(
  apiUrl: string,
  email: string,
  password: string,
  device?: string,
): Promise<AccountResult> {
  const r = await fetch(`${apiUrl}/v1/account/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, device }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `login failed (${r.status})`);
  return j as AccountResult;
}

/** Add email + password to the current anonymous account (enables cross-device). */
export async function upgradeAccount(
  s: Settings,
  email: string,
  password: string,
): Promise<{ ok: boolean; email: string }> {
  const r = await fetch(`${s.apiUrl}/v1/account/upgrade`, {
    method: 'POST',
    headers: headers(s),
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `upgrade failed (${r.status})`);
  return j;
}

export async function postReadings(
  s: Settings,
  hiveId: string,
  deviceName: string,
  readings: ReadingUpload[],
): Promise<{ ok: boolean; accepted: number }> {
  const r = await fetch(`${s.apiUrl}/v1/readings`, {
    method: 'POST',
    headers: headers(s),
    body: JSON.stringify({ hiveId, deviceName, readings }),
  });
  if (!r.ok) throw new Error(`POST /v1/readings ${r.status}`);
  return r.json();
}

export async function listHives(s: Settings): Promise<HiveSummary[]> {
  const r = await fetch(`${s.apiUrl}/v1/hives`, { headers: headers(s) });
  if (!r.ok) throw new Error(`GET /v1/hives ${r.status}`);
  const j = await r.json();
  return j.hives ?? [];
}

export async function getReadings(s: Settings, hiveId: string): Promise<HiveReading[]> {
  const r = await fetch(`${s.apiUrl}/v1/hives/${encodeURIComponent(hiveId)}/readings`, {
    headers: headers(s),
  });
  if (!r.ok) throw new Error(`GET readings ${r.status}`);
  const j = await r.json();
  return j.readings ?? [];
}

/** Delete all cloud readings for a hive (owner-only). */
export async function deleteAllReadings(s: Settings, hiveId: string): Promise<number> {
  const r = await fetch(`${s.apiUrl}/v1/hives/${encodeURIComponent(hiveId)}/readings`, {
    method: 'DELETE',
    headers: headers(s),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `DELETE readings ${r.status}`);
  return Number((j as { deleted?: number }).deleted ?? 0);
}

/** Delete specific cloud readings for a hive by timestamp (owner-only). */
export async function deleteReadingsByTimestamp(
  s: Settings,
  hiveId: string,
  timestamps: number[],
): Promise<number> {
  const clean = [...new Set(timestamps)].filter((n) => Number.isFinite(n) && n > 0);
  if (!clean.length) return 0;
  const tsParam = encodeURIComponent(clean.join(','));
  const r = await fetch(`${s.apiUrl}/v1/hives/${encodeURIComponent(hiveId)}/readings?ts=${tsParam}`, {
    method: 'DELETE',
    headers: headers(s),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `DELETE readings ${r.status}`);
  return Number((j as { deleted?: number }).deleted ?? 0);
}

/** Update a hive's mutable fields (currently the friendly name). */
export async function patchHive(
  s: Settings,
  hiveId: string,
  patch: { name?: string; region?: string; lat?: number; lon?: number },
): Promise<void> {
  const r = await fetch(`${s.apiUrl}/v1/hives/${encodeURIComponent(hiveId)}`, {
    method: 'PATCH',
    headers: headers(s),
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`PATCH /v1/hives ${r.status}`);
}

// ---------------------------------------------------------------------------
// Firmware (OTA)
//
// The binary lives on a private GitHub release fronted by the Worker; the app
// only ever talks to the Worker (with its X-API-Key), never GitHub. The
// manifest carries the sha256 + detached Ed25519 signature the app verifies
// before flashing (see lib/ota.ts).
// ---------------------------------------------------------------------------
export interface FirmwareAsset {
  name: string;
  size: number;
  downloadUrl: string;
}

export interface FirmwareManifest {
  version?: string;
  zip?: { name: string; size: number; sha256: string; sig: string };
  uf2?: { name: string; size: number; sha256: string };
  notes?: string;
  createdAt?: number;
}

export interface FirmwareInfo {
  version: string;
  notes: string;
  zip: FirmwareAsset | null;
  uf2: FirmwareAsset | null;
  manifest: FirmwareManifest | null;
}

/** Metadata for the newest published firmware (proxied from the private release). */
export async function getLatestFirmware(s: Settings): Promise<FirmwareInfo> {
  const r = await fetch(`${s.apiUrl}/v1/firmware/latest`, { headers: headers(s) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `GET /v1/firmware/latest ${r.status}`);
  return j as FirmwareInfo;
}

/** Download a firmware asset's raw bytes through the Worker (authenticated). */
export async function downloadFirmwareBytes(s: Settings, downloadUrl: string): Promise<Uint8Array> {
  const r = await fetch(downloadUrl, { headers: { 'X-API-Key': s.apiKey } });
  if (!r.ok) throw new Error(`firmware download failed (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
