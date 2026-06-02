import { Preferences } from '@capacitor/preferences';

export interface Settings {
  apiUrl: string;
  apiKey: string;
  syncEnabled: boolean;
  backgroundScan: boolean;
}

const KEY = 'openapiary.settings.v1';

const DEFAULTS: Settings = {
  apiUrl: 'https://oa-api-staging.grantjreadings.workers.dev',
  apiKey: '',
  syncEnabled: false,
  backgroundScan: false,
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
