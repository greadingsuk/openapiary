// Guided calibration + accuracy check over one BLE session. Two flows:
//
//  Empty scale (bench):  zero the scale, add a known weight (e.g. 1 kg); it
//    should read that weight. If not, recalibrate so it reads it exactly.
//
//  Hive in field:  read the current hive weight, add the known weight on top,
//    read again. The measured increase should equal the known weight (±100 g).
//    If it's outside that, recalibrate from the delta so the hive reads true.
//
// Both flows use the same maths: factor = raw_delta / known_kg, computed from
// the raw counts in the diagnostics payload and pushed to the scale. The tare
// offset is never touched, so an in-field hive keeps its baseline.
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSpinner, IonItem, IonLabel, IonInput,
} from '@ionic/react';
import {
  checkmarkCircle, warningOutline, scaleOutline, refreshOutline, leafOutline,
} from 'ionicons/icons';
import { useEffect, useRef, useState } from 'react';
import {
  findDeviceId, connectDevice, disconnectDevice, tareConnected,
  setFactorConnected, readDiagnosticsConnected, type OADiagnostics,
} from '../lib/ble';

type Mode = 'empty' | 'hive';
type Step = 'prepare' | 'connecting' | 'weigh' | 'measuring' | 'result' | 'calibrating' | 'done' | 'error';

const TOLERANCE_KG = 0.1; // ±100 g

interface Props {
  isOpen: boolean;
  deviceName: string;
  onClose: () => void;
}

const CalibrationWizard: React.FC<Props> = ({ isOpen, deviceName, onClose }) => {
  const [mode, setMode] = useState<Mode>('empty');
  const [step, setStep] = useState<Step>('prepare');
  const [knownKg, setKnownKg] = useState(1.0);
  const [baseline, setBaseline] = useState<OADiagnostics | null>(null);
  const [measured, setMeasured] = useState<OADiagnostics | null>(null);
  const [verified, setVerified] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const connectedIdRef = useRef<string | null>(null);

  const dropConnection = () => {
    const id = connectedIdRef.current;
    connectedIdRef.current = null;
    if (id) void disconnectDevice(id);
  };
  function close() { dropConnection(); onClose(); }

  useEffect(() => {
    if (isOpen) {
      setStep('prepare');
      setMode('empty');
      setKnownKg(1.0);
      setBaseline(null);
      setMeasured(null);
      setVerified(null);
      setError(null);
    } else {
      dropConnection();
    }
  }, [isOpen]);

  useEffect(() => () => dropConnection(), []);

  useEffect(() => {
    if (step !== 'connecting') return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [step]);

  function fail(e: unknown) {
    dropConnection();
    setError(e instanceof Error ? e.message : String(e));
    setStep('error');
  }

  // Connect, then establish the baseline: empty flow tares to zero first; the
  // hive flow keeps the existing load as the baseline.
  async function start(chosen: Mode) {
    setMode(chosen);
    setStep('connecting');
    setError(null);
    try {
      const found = await findDeviceId(deviceName, 65000);
      if (!found) {
        setError('Scale not found. Move closer and try again — it becomes reachable on its next heartbeat (up to ~60s).');
        setStep('error');
        return;
      }
      await connectDevice(found);
      connectedIdRef.current = found;
      if (chosen === 'empty') {
        await tareConnected(found);
      }
      const b = await readDiagnosticsConnected(found);
      setBaseline(b);
      setStep('weigh');
    } catch (e) { fail(e); }
  }

  async function measure() {
    const id = connectedIdRef.current;
    if (!id) return;
    setStep('measuring');
    try {
      const m = await readDiagnosticsConnected(id);
      setMeasured(m);
      setStep('result');
    } catch (e) { fail(e); }
  }

  async function applyCalibration() {
    const id = connectedIdRef.current;
    if (!id || !baseline || !measured) return;
    setStep('calibrating');
    try {
      const rawDelta = measured.rawCounts - baseline.rawCounts;
      const factor = rawDelta / knownKg; // kg = (raw - offset) / factor
      if (!isFinite(factor) || Math.abs(factor) < 1) {
        throw new Error('Calibration failed: the weight change was too small to read. Use a heavier reference.');
      }
      await setFactorConnected(id, factor);
      // Verify: re-read; the known-weight delta now reads exactly knownKg.
      const v = await readDiagnosticsConnected(id);
      setVerified((v.rawCounts - baseline.rawCounts) / factor);
      setStep('done');
    } catch (e) { fail(e); }
  }

  const delta = baseline != null && measured != null ? measured.weightKg - baseline.weightKg : null;
  const withinTol = delta != null && Math.abs(delta - knownKg) <= TOLERANCE_KG;

  return (
    <IonModal isOpen={isOpen} onDidDismiss={close} initialBreakpoint={1} breakpoints={[0, 1]}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Calibrate {deviceName}</IonTitle>
          <IonButtons slot="end"><IonButton onClick={close}>Close</IonButton></IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {step === 'prepare' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <IonIcon icon={scaleOutline} style={{ fontSize: 44, color: 'var(--oa-honey-500)' }} />
              <h2 className="text-lg font-semibold" style={{ color: 'var(--oa-ink)' }}>Calibration &amp; accuracy check</h2>
              <p className="text-sm oa-muted">Have a known weight ready (e.g. a 1&nbsp;kg bag of sugar). Choose how the scale is set up:</p>
            </div>
            <button className="oa-card p-6 flex items-start gap-4 text-left active:opacity-80 transition-opacity" onClick={() => { void start('empty'); }}>
              <IonIcon icon={scaleOutline} style={{ fontSize: 40, color: 'var(--oa-honey-600)', marginTop: 2, flexShrink: 0 }} />
              <div className="flex flex-col gap-1">
                <span className="text-lg font-semibold" style={{ color: 'var(--oa-ink)' }}>Empty scale</span>
                <span className="text-sm oa-muted">An unloaded test. With nothing on the platform the scale is zeroed, then you place a known weight and it should read exactly that. Best done on the bench.</span>
              </div>
            </button>
            <button className="oa-card p-6 flex items-start gap-4 text-left active:opacity-80 transition-opacity" onClick={() => { void start('hive'); }}>
              <IonIcon icon={leafOutline} style={{ fontSize: 40, color: 'var(--oa-honey-600)', marginTop: 2, flexShrink: 0 }} />
              <div className="flex flex-col gap-1">
                <span className="text-lg font-semibold" style={{ color: 'var(--oa-ink)' }}>Scale with Hive</span>
                <span className="text-sm oa-muted">A loaded test. The hive stays on the scale; you add a known weight on top and it checks the measured increase against that weight — verifying accuracy without disturbing the colony.</span>
              </div>
            </button>
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

        {(step === 'measuring' || step === 'calibrating') && (
          <div className="flex flex-col items-center gap-3 text-center py-8">
            <IonSpinner name="dots" />
            <p className="oa-muted text-sm">{step === 'calibrating' ? 'Calibrating…' : 'Reading the scale…'}</p>
          </div>
        )}

        {step === 'weigh' && baseline && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-1 text-center">
              <span className="text-xs oa-subtle">{mode === 'empty' ? 'Zeroed' : 'Current hive weight'}</span>
              <div className="flex items-baseline gap-1">
                <span className="oa-numeral font-bold" style={{ fontSize: 40, color: 'var(--oa-ink)' }}>{baseline.weightKg.toFixed(2)}</span>
                <span className="oa-muted">kg</span>
              </div>
            </div>
            <p className="text-sm oa-muted">
              {mode === 'empty'
                ? 'Now place your known weight on the scale and enter its exact weight.'
                : 'Now place your known weight on top of the hive and enter its exact weight.'}
            </p>
            <IonItem>
              <IonLabel position="stacked">Known weight (kg)</IonLabel>
              <IonInput
                type="number"
                value={knownKg}
                inputmode="decimal"
                onIonInput={(e) => setKnownKg(Math.max(0.05, parseFloat(e.detail.value ?? '1') || 1))}
              />
            </IonItem>
            <IonButton expand="block" onClick={() => { void measure(); }}>Measure</IonButton>
          </div>
        )}

        {step === 'result' && delta != null && baseline && measured && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <IonIcon icon={withinTol ? checkmarkCircle : warningOutline}
                style={{ fontSize: 44, color: withinTol ? 'var(--ion-color-success)' : 'var(--ion-color-warning)' }} />
              <h2 className="text-lg font-semibold" style={{ color: 'var(--oa-ink)' }}>
                {withinTol ? 'Accurate' : 'Needs calibration'}
              </h2>
            </div>
            <div className="oa-card p-4 flex flex-col gap-1">
              <div className="flex justify-between text-sm"><span className="oa-muted">Before</span><span className="oa-numeral" style={{ color: 'var(--oa-ink)' }}>{baseline.weightKg.toFixed(2)} kg</span></div>
              <div className="flex justify-between text-sm"><span className="oa-muted">After</span><span className="oa-numeral" style={{ color: 'var(--oa-ink)' }}>{measured.weightKg.toFixed(2)} kg</span></div>
              <div className="flex justify-between text-sm"><span className="oa-muted">Measured increase</span><span className="oa-numeral" style={{ color: 'var(--oa-ink)' }}>{delta.toFixed(2)} kg</span></div>
              <div className="flex justify-between text-sm"><span className="oa-muted">Known weight</span><span className="oa-numeral" style={{ color: 'var(--oa-ink)' }}>{knownKg.toFixed(2)} kg</span></div>
              <div className="flex justify-between text-sm"><span className="oa-muted">Error</span><span className="oa-numeral" style={{ color: withinTol ? 'var(--ion-color-success)' : 'var(--ion-color-danger)' }}>{(delta - knownKg) >= 0 ? '+' : ''}{(delta - knownKg).toFixed(2)} kg</span></div>
            </div>
            <p className="text-xs oa-subtle text-center">Tolerance ±{TOLERANCE_KG.toFixed(2)} kg</p>
            <div className="flex gap-2">
              <IonButton fill="outline" className="flex-1" onClick={() => { void measure(); }}>
                <IonIcon slot="start" icon={refreshOutline} /> Re-measure
              </IonButton>
              {withinTol ? (
                <IonButton className="flex-1" onClick={close}>Done</IonButton>
              ) : (
                <IonButton className="flex-1" onClick={() => { void applyCalibration(); }}>Calibrate now</IonButton>
              )}
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <IonIcon icon={checkmarkCircle} style={{ fontSize: 44, color: 'var(--ion-color-success)' }} />
              <h2 className="text-lg font-semibold" style={{ color: 'var(--oa-ink)' }}>Calibrated</h2>
              {verified != null && (
                <p className="text-sm oa-muted">
                  Your {knownKg.toFixed(2)} kg reference now reads {verified.toFixed(2)} kg.
                </p>
              )}
            </div>
            <p className="text-sm oa-muted text-center">
              {mode === 'empty'
                ? 'Remove the weight and put your hive back on — it will read true from here.'
                : 'Remove the extra weight — the hive now reads its true weight.'}
            </p>
            <IonButton expand="block" onClick={close}>Done</IonButton>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <IonIcon icon={warningOutline} style={{ fontSize: 40, color: 'var(--ion-color-danger)' }} />
              <h2 className="text-base font-semibold" style={{ color: 'var(--oa-ink)' }}>Calibration problem</h2>
            </div>
            <p className="text-sm oa-muted text-center">{error}</p>
            <div className="flex gap-2">
              <IonButton fill="outline" className="flex-1" onClick={close}>Cancel</IonButton>
              <IonButton className="flex-1" onClick={() => { void start(mode); }}>
                <IonIcon slot="start" icon={refreshOutline} /> Try again
              </IonButton>
            </div>
          </div>
        )}
      </IonContent>
    </IonModal>
  );
};

export default CalibrationWizard;
