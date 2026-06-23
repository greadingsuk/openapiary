import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonBackButton, IonButtons, IonButton, IonIcon,
  IonSegment, IonSegmentButton, IonLabel, IonAlert, IonToast,
  IonRefresher, IonRefresherContent, useIonViewWillEnter,
} from '@ionic/react';
import { createOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { getReadings } from '../lib/api';
import { loadSettings } from '../lib/settings';
import {
  listHivesLocal, getReadingsLocal, latestReading, insertReading,
  type Reading,
} from '../lib/db';
import { useOnline } from '../lib/useOnline';
import { freshnessFor, relativeTime } from '../lib/freshness';
import { renameHive, describeRename } from '../lib/deviceActions';
import HiveVisual from '../components/HiveVisual';
import WeightChart from '../components/WeightChart';
import { StatTile, StatusDot, EmptyState, ListSkeleton } from '../components/ui';

type Range = '24h' | '7d' | '30d';
const RANGE_MS: Record<Range, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const HiveDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const online = useOnline();
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState<string>(id);
  const [latest, setLatest] = useState<Reading | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [range, setRange] = useState<Range>('7d');
  const [showRename, setShowRename] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    // 1) Local first.
    const [hives, last, recent] = await Promise.all([
      listHivesLocal(),
      latestReading(id),
      getReadingsLocal(id, 0),
    ]);
    const h = hives.find((x) => x.id === id);
    if (h) setName(h.name);
    setLatest(last);
    setReadings(recent);
    setLoading(false);

    // 2) Cloud backfill for longer history when possible.
    try {
      const s = await loadSettings();
      if (online && s.apiKey) {
        const cloud = await getReadings(s, id);
        // Merge cloud rows into the local cache so charts have full history offline next time.
        for (const c of cloud) {
          await insertReading({
            hive_id: id,
            ts: c.ts,
            weight_kg: c.weight_kg ?? undefined,
            battery_v: c.battery_v ?? undefined,
            temp_c: c.temp_c ?? undefined,
            packet_id: c.packet_id ?? undefined,
            rssi: c.rssi ?? undefined,
          });
        }
        setReadings(await getReadingsLocal(id, 0));
        setLatest(await latestReading(id));
      }
    } catch {
      /* offline / no key — local view stands */
    }
  }

  useIonViewWillEnter(() => { void load(); });

  async function doRename(newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setName(trimmed); // optimistic
    const res = await renameHive(id, id.toUpperCase(), trimmed);
    setToast(describeRename(res));
  }

  const now = Date.now();
  const f = freshnessFor(latest?.ts ?? null, now);
  const since = now - RANGE_MS[range];
  const windowed = readings.filter((r) => r.ts >= since);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/hives" /></IonButtons>
          <IonTitle>{name}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setShowRename(true)} aria-label="Rename hive">
              <IonIcon slot="icon-only" icon={createOutline} />
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { await load(); e.detail.complete(); }}>
          <IonRefresherContent />
        </IonRefresher>

        {loading ? (
          <ListSkeleton rows={3} />
        ) : !latest && readings.length === 0 ? (
          <EmptyState
            title="Waiting for the first reading"
            message="Once this scale broadcasts, its weight and history will appear here."
          />
        ) : (
          <>
            <div className="flex flex-col items-center pt-2">
              <HiveVisual
                name={name}
                weightKg={latest?.weight_kg ?? null}
                batteryV={latest?.battery_v ?? null}
                live={f === 'live'}
              />
              <div className="flex items-center gap-3 pb-1">
                <StatusDot freshness={f} />
                <span className="oa-mono text-xs oa-subtle">{id}</span>
              </div>
            </div>

            {latest && (
              <div className="grid grid-cols-2 gap-3 px-4 py-4">
                <StatTile label="Weight" value={latest.weight_kg?.toFixed(2) ?? '--'} unit="kg" accent />
                <StatTile label="Battery" value={latest.battery_v?.toFixed(2) ?? '--'} unit="V" />
                <StatTile label="Temp" value={latest.temp_c?.toFixed(1) ?? '--'} unit="°C" />
                <StatTile label="Signal" value={latest.rssi ?? '--'} unit="dBm" />
                <div className="col-span-2">
                  <StatTile
                    label="Last seen"
                    value={relativeTime(latest.ts, now)}
                    sub={new Date(latest.ts).toLocaleString()}
                  />
                </div>
              </div>
            )}

            <div className="px-4">
              <IonSegment value={range} onIonChange={(e) => setRange((e.detail.value as Range) ?? '7d')}>
                <IonSegmentButton value="24h"><IonLabel>24h</IonLabel></IonSegmentButton>
                <IonSegmentButton value="7d"><IonLabel>7 days</IonLabel></IonSegmentButton>
                <IonSegmentButton value="30d"><IonLabel>30 days</IonLabel></IonSegmentButton>
              </IonSegment>
            </div>

            <div className="px-4 pt-4">
              <h3 className="text-sm uppercase tracking-wide oa-subtle mb-2">Weight</h3>
              <div className="oa-card p-3">
                <WeightChart readings={windowed} metric="weight" />
              </div>
            </div>
            <div className="px-4 pt-4">
              <h3 className="text-sm uppercase tracking-wide oa-subtle mb-2">Battery</h3>
              <div className="oa-card p-3">
                <WeightChart readings={windowed} metric="battery" />
              </div>
            </div>

            <h3 className="px-4 pt-6 pb-1 text-sm uppercase tracking-wide oa-subtle">
              History ({windowed.length})
            </h3>
            <div className="flex flex-col gap-2 px-4 pb-8">
              {[...windowed].reverse().slice(0, 100).map((r, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 oa-stat">
                  <div className="flex flex-col">
                    <span className="oa-numeral font-semibold" style={{ color: 'var(--oa-ink)' }}>
                      {r.weight_kg?.toFixed(2) ?? '--'} kg
                    </span>
                    <span className="text-xs oa-subtle">{new Date(r.ts).toLocaleString()}</span>
                  </div>
                  <span className="text-sm oa-muted">{r.battery_v?.toFixed(2) ?? '--'} V</span>
                </div>
              ))}
            </div>
          </>
        )}

        <IonAlert
          isOpen={showRename}
          onDidDismiss={() => setShowRename(false)}
          header="Rename hive"
          message="Up to 16 characters. We'll update the name here, in the cloud, and on the scale if it's in range."
          inputs={[{ name: 'name', type: 'text', value: name, attributes: { maxlength: 16 } }]}
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            { text: 'Save', handler: (data) => { void doRename(data.name); } },
          ]}
        />
        <IonToast
          isOpen={!!toast}
          message={toast ?? ''}
          duration={3500}
          onDidDismiss={() => setToast(null)}
        />
      </IonContent>
    </IonPage>
  );
};

export default HiveDetailPage;
