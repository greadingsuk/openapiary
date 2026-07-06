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
  apiUrl: 'https://api.openapiaryproject.com',
  apiKey: '',
  syncEnabled: true,
  backgroundScan: false,
  accountEmail: null,
};

export async function loadSettings(): Promise<Settings> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(value) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(s) });
}
