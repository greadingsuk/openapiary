import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonButton, IonIcon, IonButtons, IonFab, IonFabButton,
  IonRefresher, IonRefresherContent, useIonViewWillEnter, useIonRouter,
} from '@ionic/react';
import { add, settingsOutline, cloudOfflineOutline, batteryHalfOutline } from 'ionicons/icons';
import { useState } from 'react';
import { listHives } from '../lib/api';
import { listHivesLocal, latestReadingPerHive, type Hive, type Reading } from '../lib/db';
import { loadSettings } from '../lib/settings';
import { useOnline } from '../lib/useOnline';
import { freshnessFor, relativeTime } from '../lib/freshness';
import { StatusDot, EmptyState, ErrorState, ListSkeleton } from '../components/ui';

const HiveListPage: React.FC = () => {
  const router = useIonRouter();
  const online = useOnline();
  const [loading, setLoading] = useState(true);
  const [hives, setHives] = useState<Hive[]>([]);
  const [latest, setLatest] = useState<Map<string, Reading>>(new Map());
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    // 1) Local cache first — paints instantly and works fully offline.
    const [localHives, localLatest] = await Promise.all([
      listHivesLocal(),
      latestReadingPerHive(),
    ]);
    setHives(localHives);
    setLatest(localLatest);
    setLoading(false);

    // 2) Enrich from cloud when we can (names/new hives from other phones).
    try {
      const s = await loadSettings();
      if (online && s.apiKey) {
        const cloud = await listHives(s);
        if (cloud.length) {
          const byId = new Map(localHives.map((h) => [h.id, h]));
          for (const c of cloud) {
            byId.set(c.id, { id: c.id, name: c.name, created_at: c.created_at });
          }
          setHives([...byId.values()].sort((a, b) => a.name.localeCompare(b.name)));
        }
      } else if (!localHives.length && !s.apiKey) {
        // Nothing local and no key — nudge, but only if truly empty.
        setError('Add your API key in Settings to sync hives across devices.');
      }
    } catch (e) {
      // Cloud failed but we still have local data — only surface if we have nothing.
      if (!localHives.length) setError(e instanceof Error ? e.message : String(e));
    }
  }

  useIonViewWillEnter(() => { void load(); });

  const now = Date.now();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Hives</IonTitle>
          <IonButtons slot="end">
            {!online && (
              <IonIcon
                icon={cloudOfflineOutline}
                aria-label="Offline"
                style={{ color: 'var(--oa-kraft-500)', fontSize: 20, marginInlineEnd: 4 }}
              />
            )}
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
            {hives.map((h) => {
              const r = latest.get(h.id);
              const f = freshnessFor(r?.ts ?? null, now);
              return (
                <button
                  key={h.id}
                  className="oa-card p-4 flex items-center justify-between text-left active:opacity-80 transition-opacity"
                  onClick={() => router.push(`/hive/${encodeURIComponent(h.id)}`, 'forward')}
                >
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <span className="font-semibold truncate" style={{ color: 'var(--oa-ink)' }}>
                      {h.name}
                    </span>
                    <span className="oa-mono text-xs oa-subtle truncate">{h.id}</span>
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
                    <span className="oa-numeral text-3xl font-bold leading-none" style={{ color: 'var(--oa-honey-700)' }}>
                      {r?.weight_kg != null ? r.weight_kg.toFixed(1) : '--'}
                    </span>
                    <span className="text-xs oa-muted">kg</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <IonFab slot="fixed" vertical="bottom" horizontal="end">
          <IonFabButton routerLink="/add" aria-label="Scan for a hive">
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>
      </IonContent>
    </IonPage>
  );
};

export default HiveListPage;
