import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonBackButton, IonButtons, IonButton, IonIcon,
} from '@ionic/react';
import { bluetoothOutline, checkmarkCircle, stopCircleOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useIonRouter } from '@ionic/react';
import { startScan, stopScan, ensureBleReady, type OAAdvert } from '../lib/ble';
import { upsertHive, insertReading } from '../lib/db';
import { syncNow } from '../lib/sync';
import { loadSettings } from '../lib/settings';
import { startBackgroundScan, stopBackgroundScan } from '../lib/backgroundScan';
import { ErrorState } from '../components/ui';
import { freshnessFor } from '../lib/freshness';

const AddHivePage: React.FC = () => {
  const router = useIonRouter();
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<Map<string, OAAdvert>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  async function toggleScan() {
    if (scanning) {
      setStatus('Stopping…');
      await stopScan();
      await stopBackgroundScan();
      setScanning(false);
      setStatus(null);
      return;
    }
    setError(null);
    setSavedId(null);
    setFound(new Map());
    // Optimistic feedback so the button always responds visibly.
    setScanning(true);
    setStatus('Checking Bluetooth… tap "Allow" if iOS asks for permission.');
    try {
      // Triggers the iOS permission prompt on first run and verifies the radio.
      await ensureBleReady();
      const settings = await loadSettings();
      if (settings.backgroundScan) {
        await startBackgroundScan();
      }
      setStatus('Listening for nearby scales…');
      await startScan(async (a) => {
        setStatus(`Heard ${a.deviceName}`);
        setFound((prev) => {
          const next = new Map(prev);
          next.set(a.deviceId, a);
          return next;
        });
        // Write-through to local SQLite so nothing is ever lost.
        const hiveId = a.deviceName.toLowerCase();
        await upsertHive({ id: hiveId, name: a.deviceName, created_at: Date.now() });
        await insertReading({
          hive_id: hiveId,
          ts: a.ts,
          weight_kg: a.weightKg,
          battery_v: a.batteryV,
          temp_c: a.tempC,
          packet_id: a.packetId,
          rssi: a.rssi,
        });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
      setScanning(false);
      await stopScan().catch(() => undefined);
      await stopBackgroundScan().catch(() => undefined);
    }
  }

  useEffect(() => () => { void stopScan(); void stopBackgroundScan(); }, []);

  async function pair(a: OAAdvert) {
    try {
      const hiveId = a.deviceName.toLowerCase();
      // Already cached locally on every advert; just kick a sync.
      const r = await syncNow();
      if (r.failed.length) throw new Error(r.failed.join('; '));
      setSavedId(hiveId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const adverts = Array.from(found.values()).sort((a, b) => b.rssi - a.rssi);
  const now = Date.now();

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/hives" /></IonButtons>
          <IonTitle>Add Hive</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="px-4 py-4 flex flex-col gap-4">
          <div className="oa-card p-6 flex flex-col items-center text-center gap-4">
            <div className="relative flex items-center justify-center" style={{ width: 104, height: 104 }}>
              {scanning && (
                <>
                  <span
                    className="oa-pulse-ring absolute inset-0 rounded-full"
                    style={{ border: '2px solid var(--oa-honey-400)' }}
                  />
                  <span
                    className="oa-pulse-ring absolute inset-0 rounded-full"
                    style={{ border: '2px solid var(--oa-honey-300)', animationDelay: '0.8s' }}
                  />
                </>
              )}
              <div
                className="flex items-center justify-center rounded-full"
                style={{
                  width: 76, height: 76,
                  background: 'var(--oa-surface-1)',
                  border: '1px solid var(--oa-glass-border)',
                  boxShadow: scanning ? 'var(--oa-glow)' : 'var(--oa-shadow-2)',
                }}
              >
                <IonIcon
                  icon={bluetoothOutline}
                  style={{ fontSize: 34, color: scanning ? 'var(--oa-honey-500)' : 'var(--oa-honey-400)' }}
                />
              </div>
            </div>
            <p className="text-sm oa-muted min-h-[1.25rem] max-w-[18rem]">
              {status ?? 'Bring your phone close to an Open Apiary scale, then start scanning.'}
            </p>
            <IonButton expand="block" onClick={toggleScan} color={scanning ? 'medium' : 'primary'} className="w-full">
              <IonIcon slot="start" icon={scanning ? stopCircleOutline : bluetoothOutline} />
              {scanning ? 'Stop scan' : 'Start scan'}
            </IonButton>
          </div>

          {error && <ErrorState message={error} onRetry={() => { void toggleScan(); }} />}

          {savedId && (
            <div className="oa-card p-4 flex flex-col gap-3" style={{ borderColor: 'var(--ion-color-success)' }}>
              <div className="flex items-center gap-2">
                <IonIcon icon={checkmarkCircle} style={{ color: 'var(--ion-color-success)', fontSize: 22 }} />
                <span className="text-sm" style={{ color: 'var(--oa-ink)' }}>Paired <strong>{savedId}</strong></span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <IonButton fill="outline" onClick={() => router.push('/hives', 'back')}>
                  View hives
                </IonButton>
                <IonButton onClick={() => router.push(`/hive/${encodeURIComponent(savedId)}`, 'forward')}>
                  Open hive
                </IonButton>
              </div>
              <p className="text-xs oa-muted">
                Open the hive to move it into an apiary, tare the stand, or run an accuracy check.
              </p>
            </div>
          )}

          {adverts.length > 0 && (
            <div className="flex flex-col gap-3 pb-4">
              <div className="px-1 pt-1">
                <h2 className="oa-section text-base" style={{ color: 'var(--oa-ink)' }}>
                  Found {adverts.length} {adverts.length === 1 ? 'scale' : 'scales'}
                </h2>
              </div>
              {adverts.map((a) => {
                const f = freshnessFor(a.ts, now);
                return (
                  <button
                    key={a.deviceId}
                    className="oa-card p-4 flex items-center justify-between gap-4 text-left active:opacity-80"
                    onClick={() => pair(a)}
                  >
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="font-semibold truncate" style={{ color: 'var(--oa-ink)' }}>{a.deviceName}</span>
                      <span className="text-xs oa-muted">
                        {a.weightKg?.toFixed(2) ?? '--'} kg · {a.batteryV?.toFixed(2) ?? '--'} V
                      </span>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="oa-mono text-xs oa-subtle">{a.rssi} dBm</span>
                      <span className="text-xs" style={{ color: f === 'live' ? 'var(--ion-color-success)' : 'var(--oa-kraft-500)' }}>
                        Tap to pair
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default AddHivePage;
