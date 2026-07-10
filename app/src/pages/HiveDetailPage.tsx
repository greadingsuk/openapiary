import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonBackButton, IonButtons, IonButton, IonIcon,
  IonSegment, IonSegmentButton, IonLabel, IonAlert, IonToast, IonActionSheet,
  IonRefresher, IonRefresherContent, useIonViewWillEnter, useIonRouter,
} from '@ionic/react';
import { ellipsisHorizontal, pencilOutline, fileTrayFullOutline, hardwareChipOutline, chevronDownOutline, chevronForwardOutline, checkmarkCircle, ellipseOutline, cloudDownloadOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { getReadings } from '../lib/api';
import { loadSettings } from '../lib/settings';
import {
  listHivesLocal, getReadingsLocal, latestReading, insertReading, deleteReadings,
  type Reading,
} from '../lib/db';
import { useOnline } from '../lib/useOnline';
import { freshnessFor, relativeTime } from '../lib/freshness';
import { renameHive, describeRename } from '../lib/deviceActions';
import { syncDeviceHistory } from '../lib/history';
import { loadApiaries, apiaryOf, apiaryNames, apiaryMeta, setHiveApiary, upsertApiary } from '../lib/apiaries';
import { patchHive } from '../lib/api';
import WeightChart from '../components/WeightChart';
import { StatTile, StatusDot, EmptyState, ListSkeleton } from '../components/ui';

type Range = '24h' | '7d' | '30d' | 'custom';
const RANGE_MS: Record<'24h' | '7d' | '30d', number> = {
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
  const [customDays, setCustomDays] = useState<number>(90);
  const [askCustom, setAskCustom] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [showNewApiary, setShowNewApiary] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [collapse, setCollapse] = useState(true);
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
    // Mirror the apiary's location to the cloud hive `region` so the admin
    // console's regional analytics group this hive correctly.
    try {
      const ap = await loadApiaries();
      const meta = apiaryMeta(ap, target);
      const s = await loadSettings();
      if (s.apiKey && (typeof navigator === 'undefined' || navigator.onLine)) {
        await patchHive(s, id, { region: meta.location || target, lat: meta.lat, lon: meta.lon });
      }
    } catch { /* offline — region syncs next time */ }
    setToast(`Moved to ${target}`);
  }

  async function createApiary(nameIn: string, location: string) {
    const apName = (nameIn ?? '').trim();
    if (!apName) return;
    await upsertApiary(apName, location.trim() ? { location: location.trim() } : undefined);
    setKnownApiaries(apiaryNames(await loadApiaries()).filter((n) => n !== 'Unassigned'));
    await moveTo(apName);
  }

  async function deleteSelected() {
    await deleteReadings(id, [...selected]);
    setSelected(new Set());
    setSelectMode(false);
    await load();
    setToast('Readings deleted');
  }

  // Pull the scale's on-device log over BLE to backfill gaps passive scanning
  // missed (firmware v1.0.9+). Best-effort; needs the scale nearby and awake.
  async function doSyncHistory() {
    setToast('Syncing history from the scale\u2026');
    try {
      const res = await syncDeviceHistory(id, id.toUpperCase(), latest?.battery_v ?? undefined);
      if (!res.found) { setToast('Scale not found \u2014 make sure it is nearby and awake.'); return; }
      await load();
      setToast(res.added > 0
        ? `Synced ${res.added} reading${res.added === 1 ? '' : 's'} from the scale.`
        : 'Already up to date with the scale.');
    } catch (e: unknown) {
      setToast(`History sync failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const now = Date.now();
  const f = freshnessFor(latest?.ts ?? null, now);
  const rangeMs = range === 'custom' ? customDays * 86400_000 : RANGE_MS[range];
  const since = now - rangeMs;
  const windowed = readings.filter((r) => r.ts >= since);
  const weights = windowed.map((r) => r.weight_kg).filter((w): w is number => w != null);
  const wMin = weights.length ? Math.min(...weights) : null;
  const wMax = weights.length ? Math.max(...weights) : null;
  const wAvg = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : null;
  const fillPct = latest?.weight_kg != null
    ? Math.round(Math.max(0, Math.min(1, (latest.weight_kg - EMPTY_KG) / (FULL_KG - EMPTY_KG))) * 100)
    : null;

  // Collapse consecutive identical weights into one row so a settled scale
  // doesn't show 30+ duplicate lines. Each group carries all its timestamps
  // so selecting/deleting a group affects every underlying reading.
  interface HistGroup { weight: number | null; battery: number | null; lastTs: number; tsList: number[]; }
  const historyGroups: HistGroup[] = [];
  for (const r of [...windowed].reverse()) {
    const w = r.weight_kg ?? null;
    const prev = historyGroups[historyGroups.length - 1];
    if (collapse && prev && prev.weight === w) {
      prev.tsList.push(r.ts);
    } else {
      historyGroups.push({ weight: w, battery: r.battery_v ?? null, lastTs: r.ts, tsList: [r.ts] });
    }
  }

  function toggleGroup(g: HistGroup) {
    setSelected((prev) => {
      const n = new Set(prev);
      const allSel = g.tsList.every((t) => n.has(t));
      for (const t of g.tsList) { if (allSel) n.delete(t); else n.add(t); }
      return n;
    });
  }

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
                  {latest?.weight_kg != null ? latest.weight_kg.toFixed(2) : '--'}
                </span>
                <span className="text-lg oa-muted">kg</span>
              </div>
              {fillPct != null && <span className="text-sm oa-muted">{fillPct}% full · {apiary}</span>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Battery" value={latest?.battery_v?.toFixed(2) ?? '--'} unit="V" />
              <StatTile label="Signal" value={latest?.rssi ?? '--'} unit="dBm" />
              <StatTile label="Device temp" value={latest?.temp_c?.toFixed(1) ?? '--'} unit="°C" />
              <StatTile label="Seen" value={relativeTime(latest?.ts, now)} />
            </div>

            <IonSegment value={range} onIonChange={(e) => { const v = (e.detail.value as Range) ?? '7d'; if (v === 'custom') setAskCustom(true); setRange(v); }}>
              <IonSegmentButton value="24h"><IonLabel>1D</IonLabel></IonSegmentButton>
              <IonSegmentButton value="7d"><IonLabel>1W</IonLabel></IonSegmentButton>
              <IonSegmentButton value="30d"><IonLabel>1M</IonLabel></IonSegmentButton>
              <IonSegmentButton value="custom">
                <IonLabel>{range === 'custom' ? `${customDays}D` : 'Set'}</IonLabel>
              </IonSegmentButton>
            </IonSegment>

            <div className="oa-card p-4">
              <div className="flex justify-between mb-3">
                {[['Min', wMin], ['Avg', wAvg], ['Max', wMax]].map(([l, v]) => (
                  <div key={l as string} className="flex flex-col">
                    <span className="text-xs oa-subtle">{l as string}</span>
                    <span className="oa-numeral font-semibold" style={{ color: 'var(--oa-ink)' }}>
                      {v != null ? (v as number).toFixed(2) : '--'} kg
                    </span>
                  </div>
                ))}
              </div>
              <WeightChart readings={windowed} metric="weight" />
            </div>

            <div className="oa-card p-4">
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--oa-ink)' }}>Battery</h3>
              <WeightChart readings={windowed} metric="battery" height={120} />
            </div>

            <button className="oa-card p-4 flex items-center justify-between" onClick={() => setHistoryOpen((o) => !o)}>
              <span className="font-semibold" style={{ color: 'var(--oa-ink)' }}>History ({windowed.length})</span>
              <IonIcon icon={historyOpen ? chevronDownOutline : chevronForwardOutline} style={{ color: 'var(--oa-ink-subtle)' }} />
            </button>
            {historyOpen && (
              <>
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-4">
                    <button className="text-sm" style={{ color: 'var(--oa-honey-700)' }}
                      onClick={() => { setSelectMode((s) => !s); setSelected(new Set()); }}>
                      {selectMode ? 'Cancel' : 'Select'}
                    </button>
                    <button className="text-sm oa-muted" onClick={() => setCollapse((c) => !c)}>
                      {collapse ? 'Show all' : 'Group repeats'}
                    </button>
                  </div>
                  {selectMode && (
                    <button className="text-sm font-semibold" disabled={selected.size === 0}
                      style={{ color: selected.size ? 'var(--ion-color-danger)' : 'var(--oa-ink-subtle)' }}
                      onClick={() => setConfirmDelete(true)}>
                      Delete {selected.size || ''}
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {historyGroups.slice(0, 200).map((g) => {
                    const sel = g.tsList.some((t) => selected.has(t));
                    return (
                      <div key={g.lastTs} className="flex items-center gap-3 px-4 py-3 oa-stat"
                        onClick={() => selectMode && toggleGroup(g)} style={{ outline: sel ? '2px solid var(--oa-honey-400)' : 'none' }}>
                        {selectMode && (
                          <IonIcon icon={sel ? checkmarkCircle : ellipseOutline}
                            style={{ color: sel ? 'var(--oa-honey-600)' : 'var(--oa-ink-subtle)', fontSize: 22 }} />
                        )}
                        <div className="flex flex-col flex-1">
                          <span className="oa-numeral font-semibold flex items-center gap-2" style={{ color: 'var(--oa-ink)' }}>
                            {g.weight?.toFixed(2) ?? '--'} kg
                            {g.tsList.length > 1 && (
                              <span className="text-xs font-normal oa-muted">×{g.tsList.length}</span>
                            )}
                          </span>
                          <span className="text-xs oa-subtle">{new Date(g.lastTs).toLocaleString()}</span>
                        </div>
                        <span className="text-sm oa-muted">{g.battery?.toFixed(2) ?? '--'} V</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        <IonActionSheet isOpen={showMenu} onDidDismiss={() => setShowMenu(false)} header={name}
          buttons={[
            { text: 'Sync history from scale', icon: cloudDownloadOutline, handler: () => { void doSyncHistory(); } },
            { text: 'Rename', icon: pencilOutline, handler: () => setShowRename(true) },
            { text: 'Move to apiary', icon: fileTrayFullOutline, handler: () => setShowMove(true) },
            { text: 'Firmware update', icon: hardwareChipOutline, handler: () => router.push(`/hive/${encodeURIComponent(id)}/firmware`, 'forward') },
            { text: 'Cancel', role: 'cancel' },
          ]} />
        <IonActionSheet isOpen={showMove} onDidDismiss={() => setShowMove(false)} header="Move to apiary"
          buttons={[...knownApiaries.map((n) => ({ text: n, handler: () => moveTo(n) })),
            { text: '+ New apiary\u2026', handler: () => setShowNewApiary(true) },
            { text: 'Cancel', role: 'cancel' as const }]} />
        <IonAlert isOpen={showNewApiary} onDidDismiss={() => setShowNewApiary(false)} header="New apiary"
          message="Name your apiary and where it lives. The location powers the regional map in the admin console."
          inputs={[
            { name: 'apName', type: 'text', placeholder: 'Apiary name (e.g. Back Garden)' },
            { name: 'location', type: 'text', placeholder: 'Postcode or place (e.g. CH7 4EL)' },
          ]}
          buttons={[{ text: 'Cancel', role: 'cancel' }, { text: 'Create', handler: (d) => { void createApiary(d.apName, d.location); } }]} />
        <IonAlert isOpen={showRename} onDidDismiss={() => setShowRename(false)} header="Rename hive"
          message="Up to 16 characters. Updates here, in the cloud, and on the scale if in range."
          inputs={[{ name: 'name', type: 'text', value: name, attributes: { maxlength: 16 } }]}
          buttons={[{ text: 'Cancel', role: 'cancel' }, { text: 'Save', handler: (d) => { void doRename(d.name); } }]} />
        <IonToast isOpen={!!toast} message={toast ?? ''} duration={3000} onDidDismiss={() => setToast(null)} />
        <IonAlert isOpen={askCustom} onDidDismiss={() => setAskCustom(false)} header="Custom range"
          message="Number of days to show (1\u2013730)."
          inputs={[{ name: 'days', type: 'number', value: customDays, min: 1, max: 730 }]}
          buttons={[{ text: 'Cancel', role: 'cancel' }, { text: 'Apply', handler: (d) => { const n = Math.max(1, Math.min(730, parseInt(d.days, 10) || 90)); setCustomDays(n); setRange('custom'); } }]} />
        <IonAlert isOpen={confirmDelete} onDidDismiss={() => setConfirmDelete(false)} header="Delete readings"
          message={`Permanently delete ${selected.size} reading${selected.size === 1 ? '' : 's'}? This can't be undone.`}
          buttons={[{ text: 'Cancel', role: 'cancel' }, { text: 'Delete', role: 'destructive', handler: () => { void deleteSelected(); } }]} />
      </IonContent>
    </IonPage>
  );
};

export default HiveDetailPage;
