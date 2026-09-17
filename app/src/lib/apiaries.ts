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
  /** Hive IDs hidden on this phone after being removed locally. */
  hidden: string[];
}

export async function loadApiaries(): Promise<ApiaryStore> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return { assign: {}, order: [], meta: {}, hidden: [] };
  try {
    const p = JSON.parse(value);
    return { assign: p.assign ?? {}, order: p.order ?? [], meta: p.meta ?? {}, hidden: p.hidden ?? [] };
  } catch { return { assign: {}, order: [], meta: {}, hidden: [] }; }
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

export function isHiveHidden(s: ApiaryStore, hiveId: string): boolean {
  return s.hidden.includes(hiveId);
}

/** Hide a scale from this phone without touching its cloud-backed history. */
export async function hideHive(s: ApiaryStore, hiveId: string): Promise<void> {
  if (!s.hidden.includes(hiveId)) s.hidden.push(hiveId);
  delete s.assign[hiveId];
  await saveApiaries(s);
}

/** Make a previously removed scale visible again when it is deliberately re-added. */
export async function unhideHive(hiveId: string): Promise<void> {
  const s = await loadApiaries();
  s.hidden = s.hidden.filter((id) => id !== hiveId);
  await saveApiaries(s);
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
