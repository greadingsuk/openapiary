import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonBackButton, IonButtons, IonButton, IonIcon, IonAlert,
  IonInput, IonItem, IonLabel, IonList, IonCheckbox, IonNote,
  IonSelect, IonSelectOption, IonSpinner,
} from '@ionic/react';
import {
  bluetoothOutline, checkmarkCircle, stopCircleOutline, locateOutline,
  cloudUploadOutline, warningOutline, reloadOutline, addOutline,
} from 'ionicons/icons';
import { useEffect, useMemo, useState } from 'react';
import { useIonRouter } from '@ionic/react';
import {
  startScan, stopScan, ensureBleReady, connectDevice, tareConnected,
  readDiagnosticsConnected, findDeviceId, type OAAdvert,
} from '../lib/ble';
import { upsertHive, insertReading } from '../lib/db';
import { syncNow } from '../lib/sync';
import { renameHive } from '../lib/deviceActions';
import { loadSettings, saveSettings } from '../lib/settings';
import { startBackgroundScan, stopBackgroundScan } from '../lib/backgroundScan';
import { ErrorState } from '../components/ui';
import { freshnessFor } from '../lib/freshness';
import { loadApiaries, type ApiaryStore, upsertApiary, setHiveApiary, apiaryNames, unhideHive } from '../lib/apiaries';
import NewApiaryModal from '../components/NewApiaryModal';

const STEPS = [
  'find',
  'connect',
  'name',
  'apiary',
  'location',
  'cloud',
  'setup',
  'ready',
] as const;
type Step = typeof STEPS[number];

const AddHivePage: React.FC = () => {
  const router = useIonRouter();
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<Map<string, OAAdvert>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('find');
  const [selectedDevice, setSelectedDevice] = useState<OAAdvert | null>(null);
  const [friendlyName, setFriendlyName] = useState('');
  const [apiaries, setApiaries] = useState<ApiaryStore>({ assign: {}, order: [], meta: {}, hidden: [] });
  const [selectedApiary, setSelectedApiary] = useState<string>('');
  const [apiaryLocation, setApiaryLocation] = useState('');
  const [apiaryCoordinates, setApiaryCoordinates] = useState<{ lat: number; lon: number } | null>(null);
  const [cloudConsent, setCloudConsent] = useState(true);
  const [showNewApiaryModal, setShowNewApiaryModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tareDone, setTareDone] = useState(false);
  const [kgCheck, setKgCheck] = useState<number | null>(null);
  const [checkMessage, setCheckMessage] = useState<string>('');
  const [deviceReady, setDeviceReady] = useState(false);

  async function loadApiaryOptions() {
    const s = await loadApiaries();
    setApiaries(s);
    const first = apiaryNames(s)[0] ?? 'Unassigned';
    setSelectedApiary((prev) => prev || first);
  }

  useEffect(() => {
    void loadApiaryOptions();
  }, []);

  useEffect(() => {
    if (!selectedDevice) return;
    const current = selectedDevice.deviceName
      .replace(/^OA-/i, '')
      .replace(/[^a-z0-9]/gi, '')
      .replace(/^(.{1,2})/, '')
      .trim();
    setFriendlyName((prev) => prev || (current ? `Scale ${current.toUpperCase()}` : selectedDevice.deviceName));
  }, [selectedDevice]);

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
    setFound(new Map());
    setScanning(true);
    setStatus('Checking Bluetooth… tap "Allow" if iOS asks for permission.');
    try {
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

  async function startRegistration(a: OAAdvert) {
    setSelectedDevice(a);
    await unhideHive(a.deviceName.toLowerCase());
    await stopScan();
    await stopBackgroundScan();
    setScanning(false);
    setStatus(null);
    setStep('connect');
  }

  async function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError('Location is not available on this device. Enter a postcode or place instead.');
      return;
    }
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude: lat, longitude: lon } = position.coords;
        setApiaryCoordinates({ lat, lon });
        setApiaryLocation(`Current location (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
        setBusy(false);
      },
      () => { setError('Could not get your location. Check location permission or enter a postcode instead.'); setBusy(false); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60_000 },
    );
  }

  async function onConnectSelected() {
    if (!selectedDevice) return;
    setBusy(true);
    setError(null);
    try {
      const id = await findDeviceId(selectedDevice.deviceName);
      if (!id) throw new Error('Scale not found nearby. Move closer and wait for the next heartbeat.');
      await connectDevice(id);
      setDeviceReady(true);
      setStatus('Connected to the scale.');
      setStep('name');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveRegistration() {
    if (!selectedDevice) return;
    const hiveId = selectedDevice.deviceName.toLowerCase();
    const finalName = friendlyName.trim() || selectedDevice.deviceName;
    const chosenApiary = selectedApiary || 'Unassigned';
    const chosenLocation = apiaryLocation.trim();

    await upsertHive({ id: hiveId, name: finalName, created_at: Date.now() });
    if (chosenApiary && chosenApiary !== 'Unassigned') {
      await upsertApiary(chosenApiary, {
        ...(chosenLocation ? { location: chosenLocation } : {}),
        ...(apiaryCoordinates ?? {}),
      });
      await setHiveApiary(hiveId, chosenApiary);
    }
    await renameHive(hiveId, selectedDevice.deviceName, finalName);
    const settings = await loadSettings();
    await saveSettings({ ...settings, syncEnabled: cloudConsent });
    await syncNow();
    setStep('ready');
  }

  async function runTare() {
    if (!selectedDevice) return;
    setBusy(true);
    setError(null);
    try {
      const id = await findDeviceId(selectedDevice.deviceName);
      if (!id) throw new Error('Scale not found. Move closer and try again.');
      await connectDevice(id);
      await tareConnected(id);
      setTareDone(true);
      setStatus('Tare sent successfully.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runKgCheck() {
    if (!selectedDevice) return;
    setBusy(true);
    setError(null);
    try {
      const id = await findDeviceId(selectedDevice.deviceName);
      if (!id) throw new Error('Scale not found. Move closer and try again.');
      await connectDevice(id);
      const diag = await readDiagnosticsConnected(id);
      setKgCheck(diag.weightKg);
      const delta = Math.abs(diag.weightKg - 1);
      if (delta <= 0.2) {
        setCheckMessage('Good result — the 1 kg check is within range.');
      } else {
        setCheckMessage(`The scale read ${diag.weightKg.toFixed(2)} kg. Re-check with a known 1 kg weight or recalibrate.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function goToNext() {
    const order: Step[] = ['find', 'connect', 'name', 'apiary', 'location', 'cloud', 'setup', 'ready'];
    const idx = order.indexOf(step);
    if (idx >= 0 && idx < order.length - 1) {
      setStep(order[idx + 1]);
    }
  }

  const adverts = useMemo(() => Array.from(found.values()).sort((a, b) => b.rssi - a.rssi), [found]);
  const now = Date.now();
  const apiaryOptions = useMemo(() => apiaryNames(apiaries), [apiaries]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/hives" /></IonButtons>
          <IonTitle>Add scale</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="px-4 py-4 flex flex-col gap-4">
          {step === 'find' && (
            <>
              <div className="oa-card p-6 flex flex-col items-center text-center gap-4">
                <div className="relative flex items-center justify-center" style={{ width: 104, height: 104 }}>
                  {scanning && (
                    <>
                      <span className="oa-pulse-ring absolute inset-0 rounded-full" style={{ border: '2px solid var(--oa-honey-400)' }} />
                      <span className="oa-pulse-ring absolute inset-0 rounded-full" style={{ border: '2px solid var(--oa-honey-300)', animationDelay: '0.8s' }} />
                    </>
                  )}
                  <div className="flex items-center justify-center rounded-full" style={{ width: 76, height: 76, background: 'var(--oa-surface-1)', border: '1px solid var(--oa-glass-border)', boxShadow: scanning ? 'var(--oa-glow)' : 'var(--oa-shadow-2)' }}>
                    <IonIcon icon={bluetoothOutline} style={{ fontSize: 34, color: scanning ? 'var(--oa-honey-500)' : 'var(--oa-honey-400)' }} />
                  </div>
                </div>
                <p className="text-sm oa-muted min-h-[1.25rem] max-w-[18rem]">
                  {status ?? 'Bring your phone close to the scale, then scan for nearby devices.'}
                </p>
                <IonButton expand="block" onClick={toggleScan} color={scanning ? 'medium' : 'primary'} className="w-full" disabled={busy}>
                  <IonIcon slot="start" icon={scanning ? stopCircleOutline : bluetoothOutline} />
                  {scanning ? 'Stop scan' : 'Scan for scales'}
                </IonButton>
              </div>

              {error && <ErrorState message={error} onRetry={() => { setError(null); void toggleScan(); }} />}

              {adverts.length > 0 && (
                <div className="flex flex-col gap-3 pb-4">
                  <div className="px-1 pt-1">
                    <h2 className="oa-section text-base" style={{ color: 'var(--oa-ink)' }}>Found {adverts.length} {adverts.length === 1 ? 'scale' : 'scales'}</h2>
                  </div>
                  {adverts.map((a) => {
                    const f = freshnessFor(a.ts, now);
                    return (
                      <button
                        key={a.deviceId}
                        className="oa-card p-4 flex items-center justify-between gap-4 text-left active:opacity-80"
                        onClick={() => { void startRegistration(a); }}
                      >
                        <div className="flex flex-col gap-1 min-w-0">
                          <span className="font-semibold truncate" style={{ color: 'var(--oa-ink)' }}>{a.deviceName}</span>
                          <span className="text-xs oa-muted">{a.weightKg?.toFixed(2) ?? '--'} kg · {a.batteryV?.toFixed(2) ?? '--'} V</span>
                        </div>
                        <div className="flex flex-col items-end shrink-0">
                          <span className="oa-mono text-xs oa-subtle">{a.rssi} dBm</span>
                          <span className="text-xs" style={{ color: f === 'live' ? 'var(--ion-color-success)' : 'var(--oa-kraft-500)' }}>Set up this scale</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {step === 'connect' && selectedDevice && (
            <div className="oa-card p-5 flex flex-col gap-4">
              <h2 className="text-xl font-bold" style={{ color: 'var(--oa-ink)' }}>Connect to {selectedDevice.deviceName}</h2>
              <p className="text-sm oa-muted">This is the pairing flow for the scale itself. We keep the connection short and only use it to confirm the device and register it.</p>
              <div className="rounded-2xl p-4" style={{ background: 'var(--oa-surface-1)', border: '1px solid var(--oa-glass-border)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-sm oa-muted">Status</span>
                  <span className="text-sm font-semibold" style={{ color: deviceReady ? 'var(--ion-color-success)' : 'var(--oa-ink)' }}>{deviceReady ? 'Connected' : 'Not connected'}</span>
                </div>
              </div>
              <IonButton expand="block" onClick={onConnectSelected} disabled={busy || deviceReady}>
                {busy ? <IonSpinner name="crescent" /> : 'Connect scale'}
              </IonButton>
              <IonButton fill="clear" expand="block" onClick={() => setStep('find')}>
                Search again
              </IonButton>
            </div>
          )}

          {step === 'name' && selectedDevice && (
            <div className="oa-card p-5 flex flex-col gap-4">
              <h2 className="text-xl font-bold" style={{ color: 'var(--oa-ink)' }}>Name this scale</h2>
              <p className="text-sm oa-muted">The device name is a useful starting point, but you should give it a friendly name you will recognise in the app.</p>
              <IonItem lines="full">
                <IonLabel position="stacked">Scale name</IonLabel>
                <IonInput value={friendlyName} maxlength={30} onIonInput={(e) => setFriendlyName(String(e.detail.value ?? ''))} placeholder="North apiary scale" />
              </IonItem>
              <div className="rounded-xl p-3 text-xs oa-muted" style={{ background: 'var(--oa-surface-1)', border: '1px solid var(--oa-glass-border)' }}>
                Device ID: <strong>{selectedDevice.deviceName}</strong>
              </div>
              <IonButton expand="block" onClick={() => { setStep('apiary'); }}>Continue</IonButton>
            </div>
          )}

          {step === 'apiary' && (
            <div className="oa-card p-5 flex flex-col gap-4">
              <h2 className="text-xl font-bold" style={{ color: 'var(--oa-ink)' }}>Add to an apiary</h2>
              <p className="text-sm oa-muted">The scale must belong to an apiary so the app can group it with the right location and region.</p>
              <IonSelect
                value={selectedApiary || apiaryOptions[0] || 'Unassigned'}
                onIonChange={(e) => setSelectedApiary(String(e.detail.value ?? 'Unassigned'))}
                label="Select apiary"
                interface="action-sheet"
              >
                {apiaryOptions.map((apiary) => (
                  <IonSelectOption key={apiary} value={apiary}>{apiary}</IonSelectOption>
                ))}
              </IonSelect>
              <IonButton fill="outline" expand="block" onClick={() => setShowNewApiaryModal(true)}>
                <IonIcon slot="start" icon={addOutline} /> Create new apiary
              </IonButton>
              <IonButton expand="block" onClick={() => setStep('location')}>Continue</IonButton>
            </div>
          )}

          {step === 'location' && (
            <div className="oa-card p-5 flex flex-col gap-4">
              <h2 className="text-xl font-bold" style={{ color: 'var(--oa-ink)' }}>Apiary location</h2>
              <p className="text-sm oa-muted">Use your phone location while standing at the apiary, or enter a postcode or nearby place. We keep this at apiary level, not per reading.</p>
              <IonItem lines="full">
                <IonLabel position="stacked">Postcode / town / region</IonLabel>
                <IonInput value={apiaryLocation} onIonInput={(e) => setApiaryLocation(String(e.detail.value ?? ''))} placeholder="e.g. CH7 4EL or Anglesey" />
              </IonItem>
              <IonButton fill="outline" expand="block" onClick={() => { void useCurrentLocation(); }} disabled={busy}>
                <IonIcon slot="start" icon={locateOutline} /> {apiaryCoordinates ? 'Location captured' : 'Use current location'}
              </IonButton>
              <IonButton expand="block" onClick={() => setStep('cloud')}>Continue</IonButton>
            </div>
          )}

          {step === 'cloud' && (
            <div className="oa-card p-5 flex flex-col gap-4">
              <h2 className="text-xl font-bold" style={{ color: 'var(--oa-ink)' }}>Cloud sync and privacy</h2>
              <p className="text-sm oa-muted">Open Apiary can use anonymised readings in aggregated views to improve the project. If you keep data local only, you lose shared insights but the scale still works normally.</p>
              <div className="rounded-xl p-4" style={{ background: 'var(--oa-surface-1)', border: '1px solid var(--oa-glass-border)' }}>
                <IonCheckbox checked={cloudConsent} onIonChange={(e) => setCloudConsent(Boolean(e.detail.checked))}>I agree to anonymised aggregated data usage</IonCheckbox>
              </div>
              <IonNote color="medium" className="text-xs">By opting in, you agree that anonymised readings may be used in aggregated views for the Open Apiary project.</IonNote>
              <IonButton expand="block" onClick={() => setStep('setup')}>Continue</IonButton>
            </div>
          )}

          {step === 'setup' && selectedDevice && (
            <div className="oa-card p-5 flex flex-col gap-4">
              <h2 className="text-xl font-bold" style={{ color: 'var(--oa-ink)' }}>Final setup</h2>
              <p className="text-sm oa-muted">Before the scale is ready, do the two final checks: tare and a 1 kg weight check.</p>
              <div className="flex flex-col gap-3">
                <button className="oa-card p-4 text-left" onClick={runTare} disabled={busy}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold" style={{ color: 'var(--oa-ink)' }}>1. Tare the scale</span>
                    <span className="text-xs px-2 py-1 rounded-full" style={{ background: tareDone ? 'rgba(58, 148, 90, 0.12)' : 'var(--oa-surface-1)', color: tareDone ? 'var(--ion-color-success)' : 'var(--oa-ink-subtle)' }}>{tareDone ? 'Done' : 'Run'}</span>
                  </div>
                </button>
                <button className="oa-card p-4 text-left" onClick={runKgCheck} disabled={busy}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold" style={{ color: 'var(--oa-ink)' }}>2. 1 kg check</span>
                    <span className="text-xs px-2 py-1 rounded-full" style={{ background: kgCheck != null ? 'rgba(58, 148, 90, 0.12)' : 'var(--oa-surface-1)', color: kgCheck != null ? 'var(--ion-color-success)' : 'var(--oa-ink-subtle)' }}>{kgCheck != null ? `${kgCheck.toFixed(2)} kg` : 'Run'}</span>
                  </div>
                  {checkMessage && <div className="mt-2 text-xs oa-muted">{checkMessage}</div>}
                </button>
              </div>
              <IonButton expand="block" onClick={async () => { await saveRegistration(); }}>Finish registration</IonButton>
            </div>
          )}

          {step === 'ready' && selectedDevice && (
            <div className="oa-card p-5 flex flex-col gap-4 text-center">
              <div className="flex justify-center">
                <IonIcon icon={checkmarkCircle} style={{ color: 'var(--ion-color-success)', fontSize: 42 }} />
              </div>
              <h2 className="text-2xl font-bold" style={{ color: 'var(--oa-ink)' }}>Scale registered</h2>
              <p className="text-sm oa-muted">{friendlyName} is now attached to {selectedApiary || 'your apiary'}.</p>
              <div className="rounded-xl p-4 text-left" style={{ background: 'var(--oa-surface-1)', border: '1px solid var(--oa-glass-border)' }}>
                <div className="flex items-center justify-between text-sm"><span className="oa-muted">Name</span><strong>{friendlyName}</strong></div>
                <div className="mt-2 flex items-center justify-between text-sm"><span className="oa-muted">Apiary</span><strong>{selectedApiary || 'Unassigned'}</strong></div>
                <div className="mt-2 flex items-center justify-between text-sm"><span className="oa-muted">Cloud sync</span><strong>{cloudConsent ? 'On' : 'Local only'}</strong></div>
              </div>
              <IonButton expand="block" onClick={() => router.push('/hives', 'back')}>
                View hives
              </IonButton>
            </div>
          )}

          {error && (
            <div className="mt-2"><ErrorState message={error} onRetry={() => { setError(null); }} /></div>
          )}
        </div>

        <NewApiaryModal
          isOpen={showNewApiaryModal}
          onClose={() => setShowNewApiaryModal(false)}
          onCreate={(name, location) => {
            const trimmed = name.trim();
            if (!trimmed) return;
            setSelectedApiary(trimmed);
            setApiaryLocation(location.trim());
            void upsertApiary(trimmed, location.trim() ? { location: location.trim() } : undefined);
          }}
        />
      </IonContent>
    </IonPage>
  );
};

export default AddHivePage;
