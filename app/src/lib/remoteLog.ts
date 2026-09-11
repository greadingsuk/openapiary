// Opt-in diagnostic logging (Settings > Verbose logging). Off by default — a
// beekeeper must explicitly turn it on. When on, buffers BLE/sync events
// locally and flushes them to the cloud (POST /v1/logs) so we can read what
// actually happened on someone's device without needing them to reproduce an
// issue live. Every call is best-effort: logging must never throw or block
// the feature it's observing.
import { Capacitor } from '@capacitor/core';
import { loadSettings } from './settings';
import { APP_VERSION } from '../version';

export type LogLevel = 'info' | 'warn' | 'error';

interface BufferedEntry {
  ts: number;
  hiveId?: string;
  level: LogLevel;
  event: string;
  detail?: string;
}

let buffer: BufferedEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Record a diagnostic event. No-ops instantly unless verbose logging is on. */
export async function logEvent(
  level: LogLevel,
  event: string,
  detail?: Record<string, unknown> | string,
  hiveId?: string,
): Promise<void> {
  try {
    const s = await loadSettings();
    if (!s.verboseLogging) return;
    buffer.push({
      ts: Date.now(),
      hiveId,
      level,
      event,
      detail: detail == null ? undefined : typeof detail === 'string' ? detail : JSON.stringify(detail),
    });
    if (buffer.length >= 20) { void flush(); return; }
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, 5000);
  } catch {
    // logging must never break the feature it's observing
  }
}

async function flush(): Promise<void> {
  if (!buffer.length) return;
  const entries = buffer;
  buffer = [];
  try {
    const s = await loadSettings();
    if (!s.apiKey) return; // nothing to attribute logs to — drop silently
    await fetch(`${s.apiUrl}/v1/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': s.apiKey },
      body: JSON.stringify({ entries, appVersion: APP_VERSION, platform: Capacitor.getPlatform() }),
    });
  } catch {
    // offline or failed — best-effort diagnostics, not a guaranteed trail
  }
}
