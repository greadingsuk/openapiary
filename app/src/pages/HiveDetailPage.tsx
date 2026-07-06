import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonBackButton, IonButtons, IonButton, IonIcon,
  IonSegment, IonSegmentButton, IonLabel, IonAlert, IonToast, IonActionSheet,
  IonRefresher, IonRefresherContent, useIonViewWillEnter, useIonRouter,
} from '@ionic/react';
import { ellipsisHorizontal, pencilOutline, fileTrayFullOutline, hardwareChipOutline, chevronDownOutline, chevronForwardOutline, checkmarkCircle, ellipseOutline, warningOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getReadings,
  deleteAllReadings as deleteAllReadingsCloud,
  deleteReadingsByTimestamp,
} from '../lib/api';
import { loadSettings } from '../lib/settings';
import {
  listHivesLocal, getReadingsLocal, latestReading, insertReading, deleteReadings, deleteAllReadings, getDeletionState,
  type Reading,
} from '../lib/db';
import { useOnline } from '../lib/useOnline';
import { freshnessFor, relativeTime } from '../lib/freshness';
import { renameHive, describeRename } from '../lib/deviceActions';
import { findDeviceId, tareDevice, readDeviceDiagnostics } from '../lib/ble';
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
const BAT_RECOVERY_THRESHOLD_V = 3.3;

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
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [showNewApiary, setShowNewApiary] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [collapse, setCollapse] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [diagReport, setDiagReport] = useState<string | null>(null);

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
        const del = await getDeletionState(id);
        for (const c of cloud) {
          if (c.ts <= del.clearedBeforeTs || del.deletedTs.has(c.ts)) continue;
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
    const timestamps = [...selected];
    const s = await loadSettings();
    let deletedCloud = false;
    if (online && s.apiKey) {
      try {
        await deleteReadingsByTimestamp(s, id, timestamps);
        deletedCloud = true;
      } catch {
        deletedCloud = false;
      }
    }

    await deleteReadings(id, timestamps);
    setSelected(new Set());
    setSelectMode(false);
    await load();

    if (deletedCloud) {
      setToast('Readings deleted from device and cloud.');
    } else if (online && s.apiKey) {
      setToast('Cleared locally. Cloud delete failed, but deleted rows stay hidden on this phone.');
    } else {
      setToast('Cleared locally while offline. Cloud history was not deleted.');
    }
  }

  async function deleteAllForHive() {
    const s = await loadSettings();
    let deletedCloud = false;
    if (online && s.apiKey) {
      try {
        await deleteAllReadingsCloud(s, id);
        deletedCloud = true;
      } catch {
        deletedCloud = false;
      }
    }

    await deleteAllReadings(id);
    setSelected(new Set());
    setSelectMode(false);
    await load();

    if (deletedCloud) {
      setToast('All readings deleted from device and cloud.');
    } else if (online && s.apiKey) {
      setToast('Cleared locally. Cloud delete failed, but old rows stay hidden on this phone.');
    } else {
      setToast('Cleared locally while offline. Cloud history was not deleted.');
    }
  }

  async function runTare() {
    const deviceName = id.toUpperCase();
    setBusyAction('Taring scale');
    try {
      const deviceId = await findDeviceId(deviceName, 8000);
      if (!deviceId) {
        setToast('Scale not found. Reboot it, then try tare within the 60-second pairing window.');
        return;
      }
      await tareDevice(deviceId);
      setToast('Tare complete. The current load is now treated as zero.');
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
    }
  }

  async function runAccuracyCheck() {
    const deviceName = id.toUpperCase();
    setBusyAction('Checking stand accuracy');
    try {
      const deviceId = await findDeviceId(deviceName, 8000);
      if (!deviceId) {
        setToast('Scale not found. Reboot it, then run the check within the 60-second pairing window.');
        return;
      }
      const d = await readDeviceDiagnostics(deviceId);
      const stable = d.spreadG <= 120;
      const nearZero = Math.abs(d.weightKg) <= 0.2;
      const verdict = stable && nearZero
        ? 'Result: stable and near zero (looks good).'
        : stable
          ? 'Result: stable but not near zero (tare recommended).'
          : 'Result: noisy reading (check stand leveling/load-cell wiring).';
      setDiagReport(
        `Weight ${d.weightKg.toFixed(2)} kg\n` +
        `Spread ${d.spreadG} g\n` +
        `Raw ${d.rawCounts}\n\n` +
        `${verdict}`,
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(null);
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
  const batteryTooLowForOta = latest?.battery_v != null && latest.battery_v < BAT_RECOVERY_THRESHOLD_V;

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
                  {latest?.weight_kg != null ? latest.weight_kg.toFixed(1) : '--'}
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

            {batteryTooLowForOta && (
              <div className="oa-card p-4 flex items-start gap-3">
                <IonIcon icon={warningOutline} style={{ color: 'var(--ion-color-warning)', fontSize: 20, marginTop: 2 }} />
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold" style={{ color: 'var(--oa-ink)' }}>
                    Battery is low for firmware updates
                  </span>
                  <span className="text-xs oa-muted">
                    Current battery is {latest?.battery_v?.toFixed(2)} V. OTA updates are blocked below
                    {' '}{BAT_RECOVERY_THRESHOLD_V.toFixed(1)} V by the scale's low-battery protection.
                    Leave it in daylight to charge, then retry.
                  </span>
                </div>
              </div>
            )}

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
                      {v != null ? (v as number).toFixed(1) : '--'} kg
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
            { text: 'Rename', icon: pencilOutline, handler: () => setShowRename(true) },
            { text: 'Move to apiary', icon: fileTrayFullOutline, handler: () => setShowMove(true) },
            { text: busyAction ? 'Tare stand (busy)' : 'Tare stand', icon: checkmarkCircle, handler: () => { void runTare(); } },
            { text: busyAction ? 'Stand accuracy check (busy)' : 'Stand accuracy check', icon: warningOutline, handler: () => { void runAccuracyCheck(); } },
            { text: 'Delete all readings', role: 'destructive', handler: () => setConfirmDeleteAll(true) },
            {
              text: batteryTooLowForOta ? 'Firmware update (battery low)' : 'Firmware update',
              icon: hardwareChipOutline,
              handler: () => {
                if (batteryTooLowForOta) {
                  setToast(
                    `Battery is ${latest?.battery_v?.toFixed(2) ?? '--'} V. ` +
                    `Charge above ${BAT_RECOVERY_THRESHOLD_V.toFixed(1)} V before OTA.`,
                  );
                }
                router.push(`/hive/${encodeURIComponent(id)}/firmware`, 'forward');
              },
            },
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
        <IonAlert
          isOpen={!!diagReport}
          onDidDismiss={() => setDiagReport(null)}
          header="Stand accuracy"
          message={diagReport ?? ''}
          buttons={[{ text: 'OK', role: 'cancel' }]}
        />
        <IonAlert isOpen={askCustom} onDidDismiss={() => setAskCustom(false)} header="Custom range"
          message="Number of days to show (1\u2013730)."
          inputs={[{ name: 'days', type: 'number', value: customDays, min: 1, max: 730 }]}
          buttons={[{ text: 'Cancel', role: 'cancel' }, { text: 'Apply', handler: (d) => { const n = Math.max(1, Math.min(730, parseInt(d.days, 10) || 90)); setCustomDays(n); setRange('custom'); } }]} />
        <IonAlert isOpen={confirmDelete} onDidDismiss={() => setConfirmDelete(false)} header="Delete readings"
          message={`Permanently delete ${selected.size} reading${selected.size === 1 ? '' : 's'}? This can't be undone.`}
          buttons={[{ text: 'Cancel', role: 'cancel' }, { text: 'Delete', role: 'destructive', handler: () => { void deleteSelected(); } }]} />
        <IonAlert
          isOpen={confirmDeleteAll}
          onDidDismiss={() => setConfirmDeleteAll(false)}
          header="Delete all readings"
          message="Permanently delete every reading for this hive? This can't be undone."
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            {
              text: 'Delete all',
              role: 'destructive',
              handler: () => { void deleteAllForHive(); },
            },
          ]}
        />
      </IonContent>
    </IonPage>
  );
};

export default HiveDetailPage;
