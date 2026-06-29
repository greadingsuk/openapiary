// Apiaries = "rooms": group hives by location. Stored in Preferences as a
// hiveId → apiary-name map plus the ordered list of apiary names. Lightweight
// (no DB migration); cloud `region` can mirror this later.

import { Preferences } from '@capacitor/preferences';

const KEY = 'openapiary.apiaries.v1';
export const UNASSIGNED = 'Unassigned';

export interface ApiaryStore {
  /** hiveId → apiary name */
  assign: Record<string, string>;
  /** ordered apiary names */
  order: string[];
}

const DEFAULT: ApiaryStore = { assign: {}, order: [] };

export async function loadApiaries(): Promise<ApiaryStore> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return { ...DEFAULT };
  try { return { ...DEFAULT, ...JSON.parse(value) }; } catch { return { ...DEFAULT }; }
}

export async function saveApiaries(s: ApiaryStore): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(s) });
}

export async function setHiveApiary(hiveId: string, apiary: string): Promise<void> {
  const s = await loadApiaries();
  s.assign[hiveId] = apiary;
  if (apiary !== UNASSIGNED && !s.order.includes(apiary)) s.order.push(apiary);
  await saveApiaries(s);
}

export function apiaryOf(s: ApiaryStore, hiveId: string): string {
  return s.assign[hiveId] ?? UNASSIGNED;
}

/** Apiaries in display order, with any unknown ones appended and Unassigned last. */
export function apiaryNames(s: ApiaryStore): string[] {
  const used = new Set(Object.values(s.assign));
  const named = [...s.order.filter((n) => used.has(n))];
  for (const n of used) if (n !== UNASSIGNED && !named.includes(n)) named.push(n);
  if (used.has(UNASSIGNED) || used.size === 0) named.push(UNASSIGNED);
  return named;
}
