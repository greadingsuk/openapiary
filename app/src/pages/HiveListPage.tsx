import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonButton, IonIcon, IonButtons, IonFab, IonFabButton,
  IonRefresher, IonRefresherContent, useIonViewWillEnter, useIonRouter,
  IonActionSheet, IonToast, IonSpinner,
} from '@ionic/react';
import {
  add, settingsOutline, cloudOfflineOutline, batteryHalfOutline,
  swapVerticalOutline, fileTrayFullOutline, syncOutline,
} from 'ionicons/icons';
import { useState } from 'react';
import { listHives } from '../lib/api';
import { listHivesLocal, latestReadingPerHive, type Hive, type Reading } from '../lib/db';
import { loadSettings } from '../lib/settings';
import { useOnline } from '../lib/useOnline';
import { freshnessFor, relativeTime } from '../lib/freshness';
import { loadApiaries, apiaryOf, apiaryNames, upsertApiary, setHiveApiary, type ApiaryStore } from '../lib/apiaries';
import { syncNearbyKnownHives } from '../lib/nearbySync';
import NewApiaryModal from '../components/NewApiaryModal';
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
  const [showApiaryMenu, setShowApiaryMenu] = useState(false);
  const [showNewApiary, setShowNewApiary] = useState(false);
  const [assignHive, setAssignHive] = useState<Hive | null>(null);
  const [syncingNearby, setSyncingNearby] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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

  async function createApiary(nameIn: string, location: string) {
    const name = (nameIn ?? '').trim();
    if (!name) return;
    await upsertApiary(name, location.trim() ? { location: location.trim() } : undefined);
    setApiaries(await loadApiaries());
  }

  async function assignHiveToApiary(hiveId: string, apiary: string) {
    await setHiveApiary(hiveId, apiary);
    setApiaries(await loadApiaries());
  }

  async function runNearbySync() {
    if (syncingNearby) return;
    setSyncingNearby(true);
    try {
      const r = await syncNearbyKnownHives();
      await load();
      const cloudBits = `${r.cloud.succeeded}/${r.cloud.attempted} uploaded`;
      setToast(`Nearby sync complete: ${r.stored} reading(s) captured, ${cloudBits}.`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncingNearby(false);
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
            {r?.weight_kg != null ? r.weight_kg.toFixed(1) : '--'}
          </span>
          <span className="text-xs oa-muted">kg</span>
          <button
            className="text-xs oa-muted mt-1"
            onClick={(e) => {
              e.stopPropagation();
              setAssignHive(h);
            }}
          >
            Move
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
            <IonButton fill="clear" onClick={() => setShowApiaryMenu(true)} aria-label="Apiaries">
              <IonIcon slot="icon-only" icon={fileTrayFullOutline} />
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
          <IonFabButton
            color="light"
            aria-label="Scan paired hives"
            disabled={syncingNearby}
            onClick={() => { void runNearbySync(); }}
          >
            {syncingNearby ? <IonSpinner name="dots" /> : <IonIcon icon={syncOutline} />}
          </IonFabButton>
        </IonFab>

        <IonFab slot="fixed" vertical="bottom" horizontal="end">
          <IonFabButton routerLink="/add" aria-label="Scan for a hive">
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>

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

        <IonActionSheet
          isOpen={showApiaryMenu}
          onDidDismiss={() => setShowApiaryMenu(false)}
          header="Apiaries"
          buttons={[
            ...apiaryNames(apiaries)
              .filter((n) => n !== 'Unassigned')
              .map((n) => ({ text: n, handler: () => undefined })),
            { text: '+ New apiary…', handler: () => setShowNewApiary(true) },
            { text: 'Cancel', role: 'cancel' },
          ]}
        />

        <IonActionSheet
          isOpen={!!assignHive}
          onDidDismiss={() => setAssignHive(null)}
          header={assignHive ? `Move ${assignHive.name}` : 'Move hive'}
          buttons={[
            ...apiaryNames(apiaries)
              .filter((n) => n !== 'Unassigned')
              .map((n) => ({
                text: n,
                handler: () => { if (assignHive) void assignHiveToApiary(assignHive.id, n); },
              })),
            {
              text: '+ New apiary…',
              handler: () => {
                setAssignHive(null);
                setShowNewApiary(true);
              },
            },
            { text: 'Cancel', role: 'cancel' },
          ]}
        />

        <NewApiaryModal
          isOpen={showNewApiary}
          onClose={() => setShowNewApiary(false)}
          onCreate={(nm, loc) => { void createApiary(nm, loc); }}
        />
        <IonToast isOpen={!!toast} message={toast ?? ''} duration={3000} onDidDismiss={() => setToast(null)} />
      </IonContent>
    </IonPage>
  );
};

export default HiveListPage;
