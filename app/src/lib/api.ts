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

/** Update a hive's mutable fields (currently the friendly name). */
export async function patchHive(
  s: Settings,
  hiveId: string,
  patch: { name?: string },
): Promise<void> {
  const r = await fetch(`${s.apiUrl}/v1/hives/${encodeURIComponent(hiveId)}`, {
    method: 'PATCH',
    headers: headers(s),
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`PATCH /v1/hives ${r.status}`);
}
