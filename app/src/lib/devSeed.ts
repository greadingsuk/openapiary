// Dev-only mock data so the UI can be previewed in the browser (npm run dev)
// without a backend, BLE, or signing in. Seeds a few apiaries + hives + a week
// of readings into the in-memory store. No-op in production builds.

import { upsertHive, insertReading } from './db';
import { saveSettings, loadSettings } from './settings';
import { setHiveApiary } from './apiaries';

const SEED: Array<{ id: string; name: string; weight: number; battery: number; temp: number; apiary: string }> = [
  { id: 'oa-abcb', name: 'OA-ABCB', weight: 42.4, battery: 4.05, temp: 21.8, apiary: 'Back Garden' },
  { id: 'oa-7f31', name: 'Orchard West', weight: 58.1, battery: 3.92, temp: 23.4, apiary: 'Orchard' },
  { id: 'oa-22a9', name: 'Garden Two', weight: 31.7, battery: 4.11, temp: 20.1, apiary: 'Back Garden' },
  { id: 'oa-9c40', name: 'Heather Field', weight: 47.9, battery: 3.74, temp: 19.6, apiary: 'Orchard' },
];

/** Seed mock hives + a week of readings. Browser/dev only. */
export async function seedDevData(): Promise<void> {
  const now = Date.now();
  for (const h of SEED) {
    await upsertHive({ id: h.id, name: h.name, created_at: now - 7 * 86400_000 });
    await setHiveApiary(h.id, h.apiary);
    // 7 days of hourly-ish points with gentle drift + diurnal wobble.
    for (let i = 168; i >= 0; i--) {
      const ts = now - i * 3600_000;
      const drift = (168 - i) * 0.02;
      const wobble = Math.sin(i / 6) * 0.8;
      await insertReading({
        hive_id: h.id,
        ts,
        weight_kg: +(h.weight + drift + wobble).toFixed(2),
        battery_v: +(h.battery - i * 0.0008).toFixed(2),
        temp_c: +(h.temp + Math.sin(i / 4) * 2).toFixed(1),
        rssi: -60 - Math.round(Math.random() * 20),
        packet_id: i,
      });
    }
  }
  // Pretend we're signed in so the tabs render (skip the welcome gate in dev).
  const s = await loadSettings();
  if (!s.apiKey) {
    await saveSettings({ ...s, apiKey: 'dev-mock-key', accountEmail: 'dev@openapiary.local' });
  }
}
