// Guided tare flow. Walks the beekeeper through zeroing a scale on-site:
//   prepare -> connect -> measure -> set zero -> verify.
// Uses the short-lived GATT helpers in lib/ble.
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSpinner,
} from '@ionic/react';
import {
  checkmarkCircle, warningOutline, bluetoothOutline, scaleOutline, refreshOutline,
} from 'ionicons/icons';
import { useEffect, useRef, useState } from 'react';
import {
  findDeviceId, connectDevice, disconnectDevice, tareConnected,
  pushScheduleConnected, readDiagnosticsConnected, type OADiagnostics,
} from '../lib/ble';
import { ukDayWindow } from '../lib/sunWindow';

type Step = 'prepare' | 'connecting' | 'measure' | 'taring' | 'verify' | 'error';

interface Props {
  isOpen: boolean;
  deviceName: string;   // e.g. "OA-ABCB"
  onClose: () => void;
  /** Called with the verified post-tare weight so the hive page can refresh. */
  onTared?: (weightKg: number) => void;
}

const NEAR_ZERO_KG = 0.2;
const STABLE_SPREAD_G = 120;

const TareWizard: React.FC<Props> = ({ isOpen, deviceName, onClose, onTared }) => {
  const [step, setStep] = useState<Step>('prepare');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [diag, setDiag] = useState<OADiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Track the live connection so we can drop it when the sheet closes.
  const connectedIdRef = useRef<string | null>(null);

  const dropConnection = () => {
    const id = connectedIdRef.current;
    connectedIdRef.current = null;
    if (id) void disconnectDevice(id);
  };

  function close() {
    dropConnection();
    onClose();
  }

  useEffect(() => {
    if (isOpen) {
      setStep('prepare');
      setDeviceId(null);
      setDiag(null);
      setError(null);
    } else {
      dropConnection();
    }
  }, [isOpen]);

  // Drop the connection if the component unmounts.
  useEffect(() => () => dropConnection(), []);

  // Count up while waiting to connect so the user sees progress.
  useEffect(() => {
    if (step !== 'connecting') return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [step]);

  async function connect() {
    setStep('connecting');
    setError(null);
    try {
      const found = await findDeviceId(deviceName, 65000);
      if (!found) {
        setError('Scale not found. Move closer and try again — it becomes reachable on its next heartbeat (up to ~60s).');
        setStep('error');
        return;
      }
      // Open ONE connection and keep it open across measure -> tare -> verify
      // (the firmware holds the session up to ~2 min). Each step reuses it, so
      // we never have to wait for another heartbeat mid-flow.
      await connectDevice(found);
      connectedIdRef.current = found;
      setDeviceId(found);
      const d = await readDiagnosticsConnected(found);
      setDiag(d);
      setStep('measure');
    } catch (e) {
      dropConnection();
      setError(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  }

  async function setZero() {
    const id = connectedIdRef.current ?? deviceId;
    if (!id) return;
    setStep('taring');
    setError(null);
    try {
      const w = ukDayWindow();
      await tareConnected(id);
      await pushScheduleConnected(id, { dayStartMin: w.startMin, dayEndMin: w.endMin });
      // Re-read on the SAME connection to confirm.
      const d = await readDiagnosticsConnected(id);
      setDiag(d);
      setStep('verify');
      onTared?.(d.weightKg);
    } catch (e) {
      dropConnection();
      setError(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  }

  // Re-read the live reading on the SAME open connection (no reconnect).
  async function recheck() {
    const id = connectedIdRef.current ?? deviceId;
    if (!id) { void connect(); return; }
    try {
      const d = await readDiagnosticsConnected(id);
      setDiag(d);
    } catch (e) {
      dropConnection();
      setError(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  }

  const nearZero = diag != null && Math.abs(diag.weightKg) <= NEAR_ZERO_KG;
  const stable = diag != null && diag.spreadG <= STABLE_SPREAD_G;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={close} initialBreakpoint={1} breakpoints={[0, 1]}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Tare {deviceName}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={close}>Close</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {step === 'prepare' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <IonIcon icon={scaleOutline} style={{ fontSize: 44, color: 'var(--oa-honey-500)' }} />
              <h2 className="text-lg font-semibold" style={{ color: 'var(--oa-ink)' }}>Before you start</h2>
            </div>
            <ol className="flex flex-col gap-3 text-sm" style={{ color: 'var(--oa-ink)' }}>
              <li><strong>1.</strong> Put the scale on firm, level ground with only the empty stand on it (no hive/box).</li>
              <li><strong>2.</strong> Stand close to the scale so Bluetooth stays strong — no need to touch the scale.</li>
              <li><strong>3.</strong> Tap Connect; it links up on the scale's next heartbeat (up to ~60s).</li>
            </ol>
            <IonButton expand="block" onClick={() => { void connect(); }}>
              <IonIcon slot="start" icon={bluetoothOutline} /> Connect to scale
            </IonButton>
          </div>
        )}

        {step === 'connecting' && (
          <div className="flex flex-col items-center gap-3 text-center py-8">
            <IonSpinner name="dots" />
            <p className="oa-muted text-sm">Waiting for {deviceName}'s next heartbeat…</p>
            <p className="oa-numeral text-2xl font-semibold" style={{ color: 'var(--oa-ink)' }}>{elapsed}s</p>
            <p className="oa-subtle text-xs">Scales check in about once a minute. Keep the phone close.</p>
          </div>
        )}

        {step === 'measure' && diag && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-1 text-center">
              <span className="text-xs oa-subtle">Current reading</span>
              <div className="flex items-baseline gap-1">
                <span className="oa-numeral font-bold" style={{ fontSize: 44, color: 'var(--oa-ink)' }}>
                  {diag.weightKg.toFixed(2)}
                </span>
                <span className="oa-muted">kg</span>
              </div>
              <span className="text-xs oa-subtle">
                Stability spread {diag.spreadG} g {stable ? '(stable)' : '(settling…)'}
              </span>
            </div>
            {!stable && (
              <div className="oa-card p-3 flex items-start gap-2">
                <IonIcon icon={warningOutline} style={{ color: 'var(--ion-color-warning)', fontSize: 18, marginTop: 2 }} />
                <span className="text-xs oa-muted">
                  The reading is still moving. Wait a few seconds for it to settle, then re-check before zeroing.
                </span>
              </div>
            )}
            <p className="text-sm oa-muted">
              With only the empty stand on the scale, tap below to set this as zero.
            </p>
            <div className="flex gap-2">
              <IonButton fill="outline" className="flex-1" onClick={() => { void recheck(); }}>
                <IonIcon slot="start" icon={refreshOutline} /> Re-check
              </IonButton>
              <IonButton className="flex-1" onClick={() => { void setZero(); }}>
                Set to zero
              </IonButton>
            </div>
          </div>
        )}

        {step === 'taring' && (
          <div className="flex flex-col items-center gap-3 text-center py-8">
            <IonSpinner name="dots" />
            <p className="oa-muted text-sm">Zeroing the scale…</p>
          </div>
        )}

        {step === 'verify' && diag && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <IonIcon
                icon={nearZero ? checkmarkCircle : warningOutline}
                style={{ fontSize: 44, color: nearZero ? 'var(--ion-color-success)' : 'var(--ion-color-warning)' }}
              />
              <h2 className="text-lg font-semibold" style={{ color: 'var(--oa-ink)' }}>
                {nearZero ? 'Tare complete' : 'Almost there'}
              </h2>
              <div className="flex items-baseline gap-1">
                <span className="oa-numeral font-bold" style={{ fontSize: 36, color: 'var(--oa-ink)' }}>
                  {diag.weightKg.toFixed(2)}
                </span>
                <span className="oa-muted">kg</span>
              </div>
            </div>
            <p className="text-sm oa-muted text-center">
              {nearZero
                ? 'The empty stand now reads zero. Put your hive back on — its weight will show from here.'
                : 'It did not settle at zero. Make sure the stand is empty and level, then zero again.'}
            </p>
            <div className="flex gap-2">
              {!nearZero && (
                <IonButton fill="outline" className="flex-1" onClick={() => { void setZero(); }}>
                  Zero again
                </IonButton>
              )}
              <IonButton className="flex-1" onClick={close}>Done</IonButton>
            </div>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <IonIcon icon={warningOutline} style={{ fontSize: 40, color: 'var(--ion-color-danger)' }} />
              <h2 className="text-base font-semibold" style={{ color: 'var(--oa-ink)' }}>Couldn't tare</h2>
            </div>
            <p className="text-sm oa-muted text-center">{error}</p>
            <div className="flex gap-2">
              <IonButton fill="outline" className="flex-1" onClick={close}>Cancel</IonButton>
              <IonButton className="flex-1" onClick={() => { void connect(); }}>
                <IonIcon slot="start" icon={refreshOutline} /> Try again
              </IonButton>
            </div>
          </div>
        )}
      </IonContent>
    </IonModal>
  );
};

export default TareWizard;
