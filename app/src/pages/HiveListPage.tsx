import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonButton, IonIcon, IonButtons, IonFab, IonFabButton,
  IonRefresher, IonRefresherContent, useIonViewWillEnter, useIonRouter,
  IonActionSheet, IonToast, IonSpinner,
} from '@ionic/react';
import { add, settingsOutline, cloudOfflineOutline, batteryHalfOutline, swapVerticalOutline, syncOutline } from 'ionicons/icons';
import { useState } from 'react';
import { listHives } from '../lib/api';
import { syncNearbyKnownHives } from '../lib/nearbySync';
import { listHivesLocal, latestReadingPerHive, type Hive, type Reading } from '../lib/db';
import { loadSettings } from '../lib/settings';
import { useOnline } from '../lib/useOnline';
import { freshnessFor, relativeTime } from '../lib/freshness';
import { loadApiaries, apiaryOf, apiaryNames, type ApiaryStore } from '../lib/apiaries';
import { StatusDot, EmptyState, ErrorState, ListSkeleton } from '../components/ui';

type Sort = 'name' | 'weight' | 'recent';

const HiveListPage: React.FC = () => {
  const router = useIonRouter();
  const online = useOnline();
  const [loading, setLoading] = useState(true);
  const [hives, setHives] = useState<Hive[]>([]);
  const [latest, setLatest] = useState<Map<string, Reading>>(new Map());
  const [apiaries, setApiaries] = useState<ApiaryStore>({ assign: {}, order: [], meta: {} });
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('name');
  const [sortOpen, setSortOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Bottom-left FAB: live BLE sweep for the caller's scales, then cloud sync.
  // (Pull-to-refresh only re-reads stored/cloud data — it does not scan.)
  async function runNearbySync() {
    if (syncing) return;
    setSyncing(true);
    setToast('Scanning for your scales nearby (up to ~60s)…');
    try {
      const r = await syncNearbyKnownHives(65000, hives.map((h) => h.id));
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
    const [localHives, localLatest, ap] = await Promise.all([
      listHivesLocal(),
      latestReadingPerHive(),
      loadApiaries(),
    ]);
    setHives(localHives);
    setLatest(localLatest);
    setApiaries(ap);
    setLoading(false);

    try {
      const s = await loadSettings();
      if (online && s.apiKey) {
        const cloud = await listHives(s);
        if (cloud.length) {
          const byId = new Map(localHives.map((h) => [h.id, h]));
          for (const c of cloud) byId.set(c.id, { id: c.id, name: c.name, created_at: c.created_at });
          setHives([...byId.values()]);
        }
      }
    } catch (e) {
      if (!localHives.length) setError(e instanceof Error ? e.message : String(e));
    }
  }

  useIonViewWillEnter(() => { void load(); });

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
    return (
      <div
        key={h.id}
        role="button"
        className="oa-card p-4 flex items-center justify-between active:opacity-80 transition-opacity"
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
