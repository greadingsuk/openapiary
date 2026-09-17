import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonButton, IonIcon, IonButtons, IonFab, IonFabButton,
  IonRefresher, IonRefresherContent, useIonViewWillEnter, useIonRouter,
  IonActionSheet, IonAlert, IonToast, IonSpinner,
} from '@ionic/react';
import { add, settingsOutline, cloudOfflineOutline, batteryHalfOutline, swapVerticalOutline, syncOutline, cloudDownloadOutline } from 'ionicons/icons';
import { useState } from 'react';
import { listHives } from '../lib/api';
import { syncNearbyKnownHives } from '../lib/nearbySync';
import { syncDeviceHistory } from '../lib/history';
import { withContinuePrompts } from '../lib/retryRounds';
import {
  loadDeviceMeta, activeHeartbeatSec, scanWindowMsFor, fmtHeartbeat, type DeviceMetaStore,
} from '../lib/deviceMeta';
import { listHivesLocal, latestReadingPerHive, type Hive, type Reading } from '../lib/db';
import { loadSettings } from '../lib/settings';
import { useOnline } from '../lib/useOnline';
import { freshnessFor, relativeTime } from '../lib/freshness';
import { isHiveHidden, loadApiaries, apiaryOf, apiaryNames, type ApiaryStore } from '../lib/apiaries';
import { StatusDot, EmptyState, ErrorState, ListSkeleton } from '../components/ui';

type Sort = 'name' | 'weight' | 'recent';

const HiveListPage: React.FC = () => {
  const router = useIonRouter();
  const online = useOnline();
  const [loading, setLoading] = useState(true);
  const [hives, setHives] = useState<Hive[]>([]);
  const [latest, setLatest] = useState<Map<string, Reading>>(new Map());
  const [apiaries, setApiaries] = useState<ApiaryStore>({ assign: {}, order: [], meta: {}, hidden: [] });
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('name');
  const [sortOpen, setSortOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [liveSyncingIds, setLiveSyncingIds] = useState<Set<string>>(new Set());
  const [historySyncingIds, setHistorySyncingIds] = useState<Set<string>>(new Set());
  const [deviceMeta, setDeviceMeta] = useState<DeviceMetaStore>({});
  const [continuePrompt, setContinuePrompt] = useState<{ message: string; resolve: (v: boolean) => void } | null>(null);

  // Ask whether to keep waiting for another 2-min round, quoting the scale's
  // real (or assumed-default) heartbeat so the wait isn't a mystery.
  function askContinue(heartbeatSec: number): Promise<boolean> {
    return new Promise((resolve) => {
      setContinuePrompt({
        message: `Still no sign of the scale after 2 minutes (heartbeat set to ${fmtHeartbeat(heartbeatSec)}). Keep waiting for another 2 minutes?`,
        resolve,
      });
    });
  }

  // Bottom-left FAB: live BLE sweep for the caller's scales, then cloud sync.
  // (Pull-to-refresh only re-reads stored/cloud data — it does not scan.)
  async function runNearbySync() {
    if (syncing) return;
    setSyncing(true);
    const maxHeartbeat = hives.reduce((m, h) => Math.max(m, activeHeartbeatSec(deviceMeta[h.id])), 60);
    const scanMs = scanWindowMsFor(maxHeartbeat);
    setToast(`Scanning for your scales nearby (heartbeat ~${fmtHeartbeat(maxHeartbeat)}, up to ~${fmtHeartbeat(Math.round(scanMs / 1000))})…`);
    try {
      const r = await syncNearbyKnownHives(scanMs, hives.map((h) => h.id));
      await load();
      const cloudBits = r.cloud.attempted ? `, ${r.cloud.succeeded}/${r.cloud.attempted} uploaded` : '';
      if (r.heard === 0) {
        setToast('No scales heard nearby. Make sure a scale is powered and within range.');
      } else if (r.stored === 0) {
        // Heard the scale but its live advert was already stored. A scan only
        // grabs one live sample; use a hive's "Sync history from scale" to pull
        // the full 15-min on-device log.
        setToast(`Heard ${r.heard} scale(s) — already up to date${cloudBits}. Open a hive and "Sync history from scale" for the full log.`);
      } else {
        setToast(`Heard ${r.heard} scale(s), ${r.stored} new reading(s) captured${cloudBits}.`);
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function load() {
    setError(null);
    const [localHives, localLatest, ap, meta] = await Promise.all([
      listHivesLocal(),
      latestReadingPerHive(),
      loadApiaries(),
      loadDeviceMeta(),
    ]);
    setHives(localHives.filter((hive) => !isHiveHidden(ap, hive.id)));
    setLatest(localLatest);
    setApiaries(ap);
    setDeviceMeta(meta);
    setLoading(false);

    try {
      const s = await loadSettings();
      if (online && s.apiKey) {
        const cloud = await listHives(s);
        if (cloud.length) {
          const byId = new Map(localHives.map((h) => [h.id, h]));
          for (const c of cloud) byId.set(c.id, { id: c.id, name: c.name, created_at: c.created_at });
          setHives([...byId.values()].filter((hive) => !isHiveHidden(ap, hive.id)));
        }
      }
    } catch (e) {
      if (!localHives.length) setError(e instanceof Error ? e.message : String(e));
    }
  }

  useIonViewWillEnter(() => { void load(); });

  // Per-row quick refresh: grabs just this scale's current live advert value
  // (same mechanism as the fleet-wide FAB scan, scoped to one hive, sized to
  // its real configured heartbeat so a slower cadence isn't falsely "not heard").
  async function refreshOneHive(h: Hive) {
    if (liveSyncingIds.has(h.id)) return;
    setLiveSyncingIds((s) => new Set(s).add(h.id));
    try {
      const scanMs = scanWindowMsFor(activeHeartbeatSec(deviceMeta[h.id]));
      const r = await syncNearbyKnownHives(scanMs, [h.id]);
      await load();
      setToast(r.heard === 0
        ? `${h.name}: not heard nearby.`
        : r.stored > 0
          ? `${h.name}: ${r.stored} new reading${r.stored === 1 ? '' : 's'}.`
          : `${h.name}: already up to date.`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setLiveSyncingIds((s) => { const n = new Set(s); n.delete(h.id); return n; });
    }
  }

  // Per-row full pull: drains this scale's on-device 15-min log over BLE
  // (same mechanism as HiveDetailPage's "Sync history from scale"). Runs in
  // 2-min rounds, checking in with the user between rounds rather than
  // assuming any fixed total wait is long enough for the configured heartbeat.
  async function pullHistoryOneHive(h: Hive) {
    if (historySyncingIds.has(h.id)) return;
    setHistorySyncingIds((s) => new Set(s).add(h.id));
    const heartbeatSec = activeHeartbeatSec(deviceMeta[h.id]);
    try {
      const res = await withContinuePrompts(
        () => syncDeviceHistory(h.id, h.name.toUpperCase(), latest.get(h.id)?.battery_v ?? undefined),
        () => askContinue(heartbeatSec),
      );
      if (!res.found) { setToast(`${h.name}: scale not found — keep it within a metre and try again.`); return; }
      await load();
      setToast(res.added > 0
        ? `${h.name}: synced ${res.added} reading${res.added === 1 ? '' : 's'} from the scale.`
        : `${h.name}: already up to date with the scale.`);
    } catch (e) {
      setToast(`${h.name}: history sync failed — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setHistorySyncingIds((s) => { const n = new Set(s); n.delete(h.id); return n; });
    }
  }

  const now = Date.now();

  function sortHives(list: Hive[]): Hive[] {
    return [...list].sort((a, b) => {
      if (sort === 'weight') return (latest.get(b.id)?.weight_kg ?? 0) - (latest.get(a.id)?.weight_kg ?? 0);
      if (sort === 'recent') return (latest.get(b.id)?.ts ?? 0) - (latest.get(a.id)?.ts ?? 0);
      return a.name.localeCompare(b.name);
    });
  }

  const sections = apiaryNames(apiaries)
    .map((name) => ({ name, hives: sortHives(hives.filter((h) => apiaryOf(apiaries, h.id) === name)) }))
    .filter((s) => s.hives.length > 0);

  const renderCard = (h: Hive) => {
    const r = latest.get(h.id);
    const f = freshnessFor(r?.ts ?? null, now);
    const liveBusy = liveSyncingIds.has(h.id);
    const histBusy = historySyncingIds.has(h.id);
    return (
      <div key={h.id} className="oa-card p-4 flex flex-col gap-3">
        <div
          role="button"
          className="flex items-center justify-between active:opacity-80 transition-opacity"
          onClick={() => router.push(`/hive/${encodeURIComponent(h.id)}`, 'forward')}
        >
          <div className="flex flex-col gap-2 min-w-0">
            <span className="text-base font-semibold truncate" style={{ color: 'var(--oa-ink)' }}>{h.name}</span>
            <div className="flex items-center gap-3 pt-0.5">
              <StatusDot freshness={f} label={r ? relativeTime(r.ts, now) : 'No data'} />
              {r?.battery_v != null && (
                <span className="inline-flex items-center gap-1 text-xs oa-muted">
                  <IonIcon icon={batteryHalfOutline} aria-hidden="true" />
                  {r.battery_v.toFixed(2)} V
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end shrink-0 pl-3">
            <span className="oa-numeral text-2xl font-bold leading-none" style={{ color: 'var(--oa-honey-700)' }}>
              {r?.weight_kg != null ? r.weight_kg.toFixed(2) : '--'}
            </span>
            <span className="text-xs oa-muted">kg</span>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2" style={{ borderTop: '1px solid rgba(20, 22, 26, 0.06)' }}>
          <button
            aria-label={`Refresh ${h.name} live reading`}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-full active:opacity-70"
            style={{ minWidth: 44, minHeight: 44, background: 'rgba(20, 22, 26, 0.05)' }}
            disabled={liveBusy}
            onClick={(e) => { e.stopPropagation(); void refreshOneHive(h); }}
          >
            {liveBusy
              ? <IonSpinner name="crescent" style={{ width: 20, height: 20 }} />
              : <IonIcon icon={syncOutline} style={{ color: 'var(--oa-ink-subtle)', fontSize: 22 }} />}
            <span className="text-xs oa-muted">Refresh</span>
          </button>
          <button
            aria-label={`Pull full device history for ${h.name}`}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-full active:opacity-70"
            style={{ minWidth: 44, minHeight: 44, background: 'rgba(20, 22, 26, 0.05)' }}
            disabled={histBusy}
            onClick={(e) => { e.stopPropagation(); void pullHistoryOneHive(h); }}
          >
            {histBusy
              ? <IonSpinner name="crescent" style={{ width: 20, height: 20 }} />
              : <IonIcon icon={cloudDownloadOutline} style={{ color: 'var(--oa-ink-subtle)', fontSize: 22 }} />}
            <span className="text-xs oa-muted">Full sync</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle className="oa-title">Hives</IonTitle>
          <IonButtons slot="end">
            {!online && (
              <IonIcon icon={cloudOfflineOutline} aria-label="Offline"
                style={{ color: 'var(--oa-ink-subtle)', fontSize: 20, marginInlineEnd: 4 }} />
            )}
            <IonButton fill="clear" onClick={() => setSortOpen(true)} aria-label="Sort">
              <IonIcon slot="icon-only" icon={swapVerticalOutline} />
            </IonButton>
            <IonButton fill="clear" routerLink="/settings" aria-label="Settings">
              <IonIcon slot="icon-only" icon={settingsOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { await load(); e.detail.complete(); }}>
          <IonRefresherContent />
        </IonRefresher>

        {loading ? (
          <ListSkeleton rows={4} />
        ) : error && hives.length === 0 ? (
          <ErrorState message={error} onRetry={() => { void load(); }} />
        ) : hives.length === 0 ? (
          <EmptyState
            title="No hives yet"
            message="Bring your phone near an Open Apiary scale and scan to add your first hive."
            ctaLabel="Scan for a hive"
            ctaHref="/add"
          />
        ) : (
          <div className="flex flex-col gap-3 px-4 py-4">
            {sections.map((sec) => [
              <div key={sec.name} className="flex items-baseline justify-between px-1 pt-2">
                <h2 className="oa-section text-base" style={{ color: 'var(--oa-ink)' }}>{sec.name}</h2>
                <span className="text-xs oa-subtle">{sec.hives.length} hive{sec.hives.length === 1 ? '' : 's'}</span>
              </div>,
              ...sec.hives.map(renderCard),
            ])}
          </div>
        )}

        <IonFab slot="fixed" vertical="bottom" horizontal="start">
          <IonFabButton onClick={runNearbySync} disabled={syncing} aria-label="Scan nearby scales and sync now">
            {syncing ? <IonSpinner name="crescent" /> : <IonIcon icon={syncOutline} />}
          </IonFabButton>
        </IonFab>
        <IonFab slot="fixed" vertical="bottom" horizontal="end">
          <IonFabButton routerLink="/add" aria-label="Scan for a hive">
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>
        <IonToast isOpen={!!toast} message={toast ?? ''} duration={4000} onDidDismiss={() => setToast(null)} />
        <IonAlert
          isOpen={!!continuePrompt}
          header="Still waiting"
          message={continuePrompt?.message}
          buttons={[
            { text: 'Stop', role: 'cancel', handler: () => { continuePrompt?.resolve(false); setContinuePrompt(null); } },
            { text: 'Keep waiting', handler: () => { continuePrompt?.resolve(true); setContinuePrompt(null); } },
          ]}
        />

        <IonActionSheet
          isOpen={sortOpen}
          onDidDismiss={() => setSortOpen(false)}
          header="Sort hives by"
          buttons={[
            { text: 'Name', handler: () => setSort('name') },
            { text: 'Weight (high → low)', handler: () => setSort('weight') },
            { text: 'Recently seen', handler: () => setSort('recent') },
            { text: 'Cancel', role: 'cancel' },
          ]}
        />
      </IonContent>
    </IonPage>
  );
};

export default HiveListPage;
