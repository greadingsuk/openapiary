// Apiaries = "rooms": group hives by location. Stored in Preferences as a
// hiveId → apiary-name map, the ordered list of apiary names, and per-apiary
// metadata (location/postcode → drives the admin console regional display).

import { Preferences } from '@capacitor/preferences';

const KEY = 'openapiary.apiaries.v2';
export const UNASSIGNED = 'Unassigned';

export interface ApiaryMeta {
  /** Free-text location or postcode, used as the cloud `region` for analytics. */
  location?: string;
  lat?: number;
  lon?: number;
}

export interface ApiaryStore {
  /** hiveId → apiary name */
  assign: Record<string, string>;
  /** ordered apiary names */
  order: string[];
  /** apiary name → metadata */
  meta: Record<string, ApiaryMeta>;
}

export async function loadApiaries(): Promise<ApiaryStore> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return { assign: {}, order: [], meta: {} };
  try {
    const p = JSON.parse(value);
    return { assign: p.assign ?? {}, order: p.order ?? [], meta: p.meta ?? {} };
  } catch { return { assign: {}, order: [], meta: {} }; }
}

export async function saveApiaries(s: ApiaryStore): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(s) });
}

/** Create (or update) an apiary with an optional location. */
export async function upsertApiary(name: string, meta?: ApiaryMeta): Promise<void> {
  const s = await loadApiaries();
  if (!s.order.includes(name)) s.order.push(name);
  if (meta) s.meta[name] = { ...s.meta[name], ...meta };
  await saveApiaries(s);
}

export async function setHiveApiary(hiveId: string, apiary: string): Promise<void> {
  const s = await loadApiaries();
  s.assign[hiveId] = apiary;
  if (apiary !== UNASSIGNED && !s.order.includes(apiary)) s.order.push(apiary);
  await saveApiaries(s);
}

/**
 * Seed the local apiary store from cloud hives so apiary grouping survives an
 * app reinstall. Only fills gaps — never clobbers a local assignment the user
 * may have just made. Returns the updated store.
 */
export async function seedApiariesFromCloud(
  hives: { id: string; apiary?: string | null; region?: string | null; lat?: number | null; lon?: number | null }[],
): Promise<ApiaryStore> {
  const s = await loadApiaries();
  let changed = false;
  for (const h of hives) {
    const ap = (h.apiary ?? '').trim();
    if (!ap) continue;
    if (!(h.id in s.assign)) { s.assign[h.id] = ap; changed = true; }
    if (!s.order.includes(ap)) { s.order.push(ap); changed = true; }
    const cur = s.meta[ap] ?? {};
    const merged: ApiaryMeta = {
      location: cur.location ?? (h.region ?? undefined),
      lat: cur.lat ?? (h.lat ?? undefined),
      lon: cur.lon ?? (h.lon ?? undefined),
    };
    if (JSON.stringify(merged) !== JSON.stringify(cur)) { s.meta[ap] = merged; changed = true; }
  }
  if (changed) await saveApiaries(s);
  return s;
}

export function apiaryOf(s: ApiaryStore, hiveId: string): string {
  return s.assign[hiveId] ?? UNASSIGNED;
}

export function apiaryMeta(s: ApiaryStore, name: string): ApiaryMeta {
  return s.meta[name] ?? {};
}

/** Apiaries in display order, with any unknown ones appended and Unassigned last. */
export function apiaryNames(s: ApiaryStore): string[] {
  const used = new Set(Object.values(s.assign));
  const all = new Set([...s.order, ...used]);
  const named = [...all].filter((n) => n !== UNASSIGNED);
  if (used.has(UNASSIGNED) || used.size === 0) named.push(UNASSIGNED);
  return named;
}
