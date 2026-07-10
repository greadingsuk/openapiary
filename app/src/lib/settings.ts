import { Preferences } from '@capacitor/preferences';

export interface Settings {
  apiUrl: string;
  apiKey: string;
  syncEnabled: boolean;
  backgroundScan: boolean;
  /** Email of the signed-in account, or null for an anonymous "try it" account. */
  accountEmail: string | null;
}

const KEY = 'openapiary.settings.v1';

const DEFAULTS: Settings = {
  apiUrl: 'https://api.openapiary.co.uk',
  apiKey: '',
  syncEnabled: false,
  backgroundScan: false,
  accountEmail: null,
};

export async function loadSettings(): Promise<Settings> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return { ...DEFAULTS };
  try {
    // Always pin apiUrl to the current default. Older builds persisted a
    // staging URL, and a stale saved value would otherwise override the new
    // default and send the app to the wrong (outdated) backend.
    return { ...DEFAULTS, ...JSON.parse(value), apiUrl: DEFAULTS.apiUrl };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(s) });
}
