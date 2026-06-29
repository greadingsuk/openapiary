import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonBackButton, IonButtons, IonButton, IonIcon,
} from '@ionic/react';
import { bluetoothOutline, checkmarkCircle, stopCircleOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { startScan, stopScan, ensureBleReady, type OAAdvert } from '../lib/ble';
import { upsertHive, insertReading } from '../lib/db';
import { syncNow } from '../lib/sync';
import { loadSettings } from '../lib/settings';
import { startBackgroundScan, stopBackgroundScan } from '../lib/backgroundScan';
import { ErrorState } from '../components/ui';
import { freshnessFor } from '../lib/freshness';

const AddHivePage: React.FC = () => {
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
        {/* Scanning hero — pulsing radio while we listen for adverts. */}
        <div className="flex flex-col items-center text-center px-6 pt-8 pb-4">
          <div className="relative flex items-center justify-center" style={{ width: 96, height: 96 }}>
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
                width: 72, height: 72,
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
          <p className="text-sm oa-muted mt-4 min-h-[1.25rem]">
            {status ?? 'Bring your phone close to an Open Apiary scale, then start scanning.'}
          </p>
        </div>

        <div className="px-4">
          <IonButton expand="block" onClick={toggleScan} color={scanning ? 'medium' : 'primary'}>
            <IonIcon slot="start" icon={scanning ? stopCircleOutline : bluetoothOutline} />
            {scanning ? 'Stop scan' : 'Start scan'}
          </IonButton>
        </div>

        {error && <ErrorState message={error} onRetry={() => { void toggleScan(); }} />}
        {savedId && (
          <div className="oa-card mx-4 my-4 p-4 flex items-center gap-2" style={{ borderColor: 'var(--ion-color-success)' }}>
            <IonIcon icon={checkmarkCircle} style={{ color: 'var(--ion-color-success)', fontSize: 22 }} />
            <span className="text-sm" style={{ color: 'var(--oa-ink)' }}>Paired <strong>{savedId}</strong></span>
          </div>
        )}

        {adverts.length > 0 && (
          <>
            <h2 className="px-4 pt-4 pb-1 text-sm uppercase tracking-wide oa-subtle">
              Found {adverts.length} {adverts.length === 1 ? 'scale' : 'scales'}
            </h2>
            <div className="flex flex-col gap-3 px-4 pb-8">
              {adverts.map((a) => {
                const f = freshnessFor(a.ts, now);
                return (
                  <button
                    key={a.deviceId}
                    className="oa-card p-4 flex items-center justify-between text-left active:opacity-80"
                    onClick={() => pair(a)}
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold" style={{ color: 'var(--oa-ink)' }}>{a.deviceName}</span>
                      <span className="text-xs oa-muted">
                        {a.weightKg?.toFixed(2) ?? '--'} kg · {a.batteryV?.toFixed(2) ?? '--'} V
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="oa-mono text-xs oa-subtle">{a.rssi} dBm</span>
                      <span className="text-xs" style={{ color: f === 'live' ? 'var(--ion-color-success)' : 'var(--oa-kraft-500)' }}>
                        Tap to pair
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </IonContent>
    </IonPage>
  );
};

export default AddHivePage;
