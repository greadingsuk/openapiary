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
