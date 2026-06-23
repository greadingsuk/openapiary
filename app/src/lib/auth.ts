// Authentication store. Wraps the account API + Settings persistence and exposes
// a tiny subscribe/useAuth hook so the app can gate the UI on sign-in state.
//
// The signed-in credential is the per-device API key returned by the Worker on
// register/login. The user never sees or types it — it's stored in Preferences.

import { useSyncExternalStore } from 'react';
import { loadSettings, saveSettings } from './settings';
import { registerAccount, loginAccount, upgradeAccount } from './api';
import { clearLocalData } from './db';

export interface AuthState {
  ready: boolean;            // settings have loaded at least once
  authed: boolean;          // we hold a usable API key
  email: string | null;     // null = anonymous "try it" account
  apiUrl: string;
}

let state: AuthState = { ready: false, authed: false, email: null, apiUrl: '' };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setState(next: Partial<AuthState>) {
  state = { ...state, ...next };
  emit();
}

/** Load persisted auth into the store. Call once on app boot. */
export async function initAuth(): Promise<void> {
  const s = await loadSettings();
  setState({
    ready: true,
    authed: !!s.apiKey,
    email: s.accountEmail,
    apiUrl: s.apiUrl,
  });
}

async function persistAuth(apiKey: string, email: string | null) {
  const s = await loadSettings();
  await saveSettings({ ...s, apiKey, accountEmail: email, syncEnabled: true });
  setState({ authed: true, email, apiUrl: s.apiUrl });
}

export async function signUp(email: string, password: string): Promise<void> {
  const s = await loadSettings();
  const r = await registerAccount(s.apiUrl, email, password);
  await persistAuth(r.api_key, r.email);
}

export async function signIn(email: string, password: string): Promise<void> {
  const s = await loadSettings();
  const r = await loginAccount(s.apiUrl, email, password, deviceLabel());
  await persistAuth(r.api_key, r.email);
}

/** Anonymous "try it" account — instant start, can be upgraded later. */
export async function startAnonymous(): Promise<void> {
  const s = await loadSettings();
  const r = await registerAccount(s.apiUrl);
  await persistAuth(r.api_key, null);
}

/** Add email + password to the current anonymous account. */
export async function addCredentials(email: string, password: string): Promise<void> {
  const s = await loadSettings();
  await upgradeAccount(s, email, password);
  await saveSettings({ ...s, accountEmail: email });
  setState({ email });
}

export async function signOut(): Promise<void> {
  const s = await loadSettings();
  await saveSettings({ ...s, apiKey: '', accountEmail: null, syncEnabled: false });
  await clearLocalData();          // don't show the previous account's hives
  setState({ authed: false, email: null });
}

function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'device';
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return 'iPhone';
  if (/android/i.test(ua)) return 'Android';
  return 'device';
}

// ---- React binding ----
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot() {
  return state;
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
