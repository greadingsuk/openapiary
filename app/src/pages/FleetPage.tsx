// Fleet overview — an at-a-glance summary of every hive the phone has heard,
// read from the local cache first (works offline) and enriched from the cloud
// when a network and API key are available.

import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonRefresher, IonRefresherContent, useIonViewWillEnter,
} from '@ionic/react';
import { useState } from 'react';
import { listHivesLocal, latestReadingPerHive, type Hive, type Reading } from '../lib/db';
import { listHives } from '../lib/api';
import { loadSettings } from '../lib/settings';
import { useOnline } from '../lib/useOnline';
import { freshnessFor, relativeTime } from '../lib/freshness';
import { StatTile, StatusDot, EmptyState, ListSkeleton } from '../components/ui';

const FleetPage: React.FC = () => {
  const online = useOnline();
  const [loading, setLoading] = useState(true);
  const [hives, setHives] = useState<Hive[]>([]);
  const [latest, setLatest] = useState<Map<string, Reading>>(new Map());

  async function load() {
    // 1) Local cache first — instant, offline-safe.
    const [localHives, localLatest] = await Promise.all([
      listHivesLocal(),
      latestReadingPerHive(),
    ]);
    setHives(localHives);
    setLatest(localLatest);
    setLoading(false);

    // 2) Enrich names from cloud when possible (non-fatal).
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
      }
    } catch {
      /* offline / no key — local view stands */
    }
  }

  useIonViewWillEnter(() => { void load(); });

  const now = Date.now();
  const liveCount = [...latest.values()].filter((r) => freshnessFor(r.ts, now) === 'live').length;
  const totalWeight = [...latest.values()].reduce((sum, r) => sum + (r.weight_kg ?? 0), 0);
  const recent = [...latest.entries()]
    .sort((a, b) => b[1].ts - a[1].ts)
    .slice(0, 6);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle className="oa-title">Fleet</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { await load(); e.detail.complete(); }}>
          <IonRefresherContent />
        </IonRefresher>

        {loading ? (
          <ListSkeleton rows={3} />
        ) : hives.length === 0 ? (
          <EmptyState
            title="No hives yet"
            message="Once you add a scale, your whole apiary shows up here at a glance."
            ctaLabel="Add a hive"
            ctaHref="/add"
          />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 px-4 py-4">
              <StatTile label="Hives" value={hives.length} />
              <StatTile label="Live" value={liveCount} accent />
              <StatTile label="Total" value={totalWeight.toFixed(1)} unit="kg" />
            </div>

            <h2 className="px-4 pt-2 pb-1 text-sm uppercase tracking-wide oa-subtle">
              Recent activity
            </h2>
            <div className="flex flex-col gap-3 px-4 pb-6">
              {recent.map(([id, r]) => {
                const h = hives.find((x) => x.id === id);
                const f = freshnessFor(r.ts, now);
                return (
                  <div key={id} className="oa-card p-4 flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold" style={{ color: 'var(--oa-ink)' }}>
                        {h?.name ?? id}
                      </span>
                      <StatusDot freshness={f} label={`${relativeTime(r.ts, now)}`} />
                    </div>
                    <span className="oa-numeral text-xl font-semibold" style={{ color: 'var(--oa-honey-700)' }}>
                      {r.weight_kg != null ? r.weight_kg.toFixed(1) : '--'}
                      <span className="text-sm oa-muted"> kg</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default FleetPage;
