import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonBackButton, IonButtons, IonButton, IonIcon,
  IonSegment, IonSegmentButton, IonLabel, IonAlert, IonToast, IonActionSheet,
  IonRefresher, IonRefresherContent, useIonViewWillEnter, useIonRouter,
} from '@ionic/react';
import { ellipsisHorizontal, pencilOutline, fileTrayFullOutline, hardwareChipOutline, chevronDownOutline, chevronForwardOutline } from 'ionicons/icons';
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
import { loadApiaries, apiaryOf, apiaryNames, setHiveApiary } from '../lib/apiaries';
import WeightChart from '../components/WeightChart';
import { StatTile, StatusDot, EmptyState, ListSkeleton } from '../components/ui';

type Range = '24h' | '7d' | '30d';
const RANGE_MS: Record<Range, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};
const EMPTY_KG = 18, FULL_KG = 60;

const HiveDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const router = useIonRouter();
  const online = useOnline();
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState<string>(id);
  const [apiary, setApiary] = useState<string>('Unassigned');
  const [knownApiaries, setKnownApiaries] = useState<string[]>([]);
  const [latest, setLatest] = useState<Reading | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [range, setRange] = useState<Range>('7d');
  const [showRename, setShowRename] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    const [hives, last, recent, ap] = await Promise.all([
      listHivesLocal(), latestReading(id), getReadingsLocal(id, 0), loadApiaries(),
    ]);
    const h = hives.find((x) => x.id === id);
    if (h) setName(h.name);
    setApiary(apiaryOf(ap, id));
    setKnownApiaries(apiaryNames(ap).filter((n) => n !== 'Unassigned'));
    setLatest(last);
    setReadings(recent);
    setLoading(false);
    try {
      const s = await loadSettings();
      if (online && s.apiKey) {
        const cloud = await getReadings(s, id);
        for (const c of cloud) {
          await insertReading({
            hive_id: id, ts: c.ts, weight_kg: c.weight_kg ?? undefined,
            battery_v: c.battery_v ?? undefined, temp_c: c.temp_c ?? undefined,
            packet_id: c.packet_id ?? undefined, rssi: c.rssi ?? undefined,
          });
        }
        setReadings(await getReadingsLocal(id, 0));
        setLatest(await latestReading(id));
      }
    } catch { /* offline */ }
  }

  useIonViewWillEnter(() => { void load(); });

  async function doRename(newName: string) {
    const trimmed = (newName ?? '').trim();
    if (!trimmed) return;
    setName(trimmed);
    const res = await renameHive(id, id.toUpperCase(), trimmed);
    setToast(describeRename(res));
  }

  async function moveTo(target: string) {
    await setHiveApiary(id, target);
    setApiary(target);
    setToast(`Moved to ${target}`);
  }

  const now = Date.now();
  const f = freshnessFor(latest?.ts ?? null, now);
  const since = now - RANGE_MS[range];
  const windowed = readings.filter((r) => r.ts >= since);
  const weights = windowed.map((r) => r.weight_kg).filter((w): w is number => w != null);
  const wMin = weights.length ? Math.min(...weights) : null;
  const wMax = weights.length ? Math.max(...weights) : null;
  const wAvg = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : null;
  const fillPct = latest?.weight_kg != null
    ? Math.round(Math.max(0, Math.min(1, (latest.weight_kg - EMPTY_KG) / (FULL_KG - EMPTY_KG))) * 100)
    : null;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/hives" /></IonButtons>
          <IonTitle>{name}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={() => setShowMenu(true)} aria-label="Hive options">
              <IonIcon slot="icon-only" icon={ellipsisHorizontal} />
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
          <EmptyState title="Waiting for the first reading"
            message="Once this scale broadcasts, its weight and history will appear here." />
        ) : (
          <div className="px-4 py-4 flex flex-col gap-4">
            <div className="oa-card p-5 flex flex-col items-center gap-1">
              <StatusDot freshness={f} />
              <div className="flex items-baseline gap-1 mt-1">
                <span className="oa-numeral font-bold" style={{ fontSize: 56, lineHeight: 1, color: 'var(--oa-ink)' }}>
                  {latest?.weight_kg != null ? latest.weight_kg.toFixed(1) : '--'}
                </span>
                <span className="text-lg oa-muted">kg</span>
              </div>
              {fillPct != null && <span className="text-sm oa-muted">{fillPct}% full · {apiary}</span>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Battery" value={latest?.battery_v?.toFixed(2) ?? '--'} unit="V" />
              <StatTile label="Temp" value={latest?.temp_c?.toFixed(1) ?? '--'} unit="°C" />
              <StatTile label="Signal" value={latest?.rssi ?? '--'} unit="dBm" />
              <StatTile label="Seen" value={relativeTime(latest?.ts, now)} />
            </div>

            <IonSegment value={range} onIonChange={(e) => setRange((e.detail.value as Range) ?? '7d')}>
              <IonSegmentButton value="24h"><IonLabel>24h</IonLabel></IonSegmentButton>
              <IonSegmentButton value="7d"><IonLabel>7 days</IonLabel></IonSegmentButton>
              <IonSegmentButton value="30d"><IonLabel>30 days</IonLabel></IonSegmentButton>
            </IonSegment>

            <div className="oa-card p-4">
              <div className="flex justify-between mb-3">
                {[['Min', wMin], ['Avg', wAvg], ['Max', wMax]].map(([l, v]) => (
                  <div key={l as string} className="flex flex-col">
                    <span className="text-xs oa-subtle">{l as string}</span>
                    <span className="oa-numeral font-semibold" style={{ color: 'var(--oa-ink)' }}>
                      {v != null ? (v as number).toFixed(1) : '--'} kg
                    </span>
                  </div>
                ))}
              </div>
              <WeightChart readings={windowed} metric="weight" />
            </div>

            <div className="oa-card p-4">
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--oa-ink)' }}>Battery</h3>
              <WeightChart readings={windowed} metric="battery" />
            </div>

            <button className="oa-card p-4 flex items-center justify-between" onClick={() => setHistoryOpen((o) => !o)}>
              <span className="font-semibold" style={{ color: 'var(--oa-ink)' }}>History ({windowed.length})</span>
              <IonIcon icon={historyOpen ? chevronDownOutline : chevronForwardOutline} style={{ color: 'var(--oa-ink-subtle)' }} />
            </button>
            {historyOpen && (
              <div className="flex flex-col gap-2">
                {[...windowed].reverse().slice(0, 100).map((r, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3 oa-stat">
                    <div className="flex flex-col">
                      <span className="oa-numeral font-semibold" style={{ color: 'var(--oa-ink)' }}>{r.weight_kg?.toFixed(2) ?? '--'} kg</span>
                      <span className="text-xs oa-subtle">{new Date(r.ts).toLocaleString()}</span>
                    </div>
                    <span className="text-sm oa-muted">{r.battery_v?.toFixed(2) ?? '--'} V</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <IonActionSheet isOpen={showMenu} onDidDismiss={() => setShowMenu(false)} header={name}
          buttons={[
            { text: 'Rename', icon: pencilOutline, handler: () => setShowRename(true) },
            { text: 'Move to apiary', icon: fileTrayFullOutline, handler: () => setShowMove(true) },
            { text: 'Firmware update', icon: hardwareChipOutline, handler: () => router.push(`/hive/${encodeURIComponent(id)}/firmware`, 'forward') },
            { text: 'Cancel', role: 'cancel' },
          ]} />
        <IonActionSheet isOpen={showMove} onDidDismiss={() => setShowMove(false)} header="Move to apiary"
          buttons={[...knownApiaries.map((n) => ({ text: n, handler: () => moveTo(n) })),
            { text: 'Cancel', role: 'cancel' as const }]} />
        <IonAlert isOpen={showRename} onDidDismiss={() => setShowRename(false)} header="Rename hive"
          message="Up to 16 characters. Updates here, in the cloud, and on the scale if in range."
          inputs={[{ name: 'name', type: 'text', value: name, attributes: { maxlength: 16 } }]}
          buttons={[{ text: 'Cancel', role: 'cancel' }, { text: 'Save', handler: (d) => { void doRename(d.name); } }]} />
        <IonToast isOpen={!!toast} message={toast ?? ''} duration={3000} onDidDismiss={() => setToast(null)} />
      </IonContent>
    </IonPage>
  );
};

export default HiveDetailPage;
