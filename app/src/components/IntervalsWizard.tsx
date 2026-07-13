// Measurement-intervals editor (firmware v1.1.0+). Connects to a scale over its
// pairing window, reads the current per-season cadences, lets the beekeeper
// adjust them, and writes them back (the firmware clamps + persists to flash).
//
// Two seasons: On-season (summer) and Off-season (winter). Heartbeat = how often
// the scale wakes to advertise; Reading = how often it takes + logs a full
// weight. Off-season uses longer reading intervals to save power and flash.
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSpinner, IonRange, IonLabel,
} from '@ionic/react';
import { sunnyOutline, snowOutline, pulseOutline, timeOutline } from 'ionicons/icons';
import { useEffect, useRef, useState } from 'react';
import {
  findDeviceId, connectDevice, disconnectDevice,
  readIntervalsConnected, setIntervalsConnected, type SeasonIntervals,
} from '../lib/ble';

type Step = 'connecting' | 'edit' | 'saving' | 'done' | 'error';

// Weight ring capacity on the device (firmware WLOG_CAP) — used to estimate how
// long the on-device history covers at a given reading cadence.
const WEIGHT_RING = 5600;

interface Props {
  isOpen: boolean;
  deviceName: string;
  onClose: () => void;
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = sec / 3600;
  return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`;
}

function retentionDays(readingSec: number): string {
  const days = (WEIGHT_RING * readingSec) / 86400;
  return days >= 1 ? `${Math.round(days)} days` : `${Math.round(days * 24)} h`;
}

const DEFAULTS: SeasonIntervals = {
  summerHeartbeatSec: 60, summerReadingSec: 900,
  winterHeartbeatSec: 60, winterReadingSec: 3600,
};

const IntervalsWizard: React.FC<Props> = ({ isOpen, deviceName, onClose }) => {
  const [step, setStep] = useState<Step>('connecting');
  const [iv, setIv] = useState<SeasonIntervals>(DEFAULTS);
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
    if (!isOpen) { dropConnection(); return; }
    setStep('connecting');
    setError(null);
    setElapsed(0);
    (async () => {
      try {
        const id = await findDeviceId(deviceName, 65000);
        if (!id) {
          setError('Scale not found. Move closer and try again — it becomes reachable on its next heartbeat (up to ~60s).');
          setStep('error');
          return;
        }
        await connectDevice(id);
        connectedIdRef.current = id;
        setIv(await readIntervalsConnected(id));
        setStep('edit');
      } catch (e) {
        dropConnection();
        setError(e instanceof Error ? e.message : String(e));
        setStep('error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => () => dropConnection(), []);

  useEffect(() => {
    if (step !== 'connecting') return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [step]);

  async function save() {
    const id = connectedIdRef.current;
    if (!id) return;
    setStep('saving');
    try {
      await setIntervalsConnected(id, iv);
      setStep('done');
    } catch (e) {
      dropConnection();
      setError(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  }

  const Row = ({ icon, label, value, min, max, step: st, onChange }: {
    icon: string; label: string; value: number; min: number; max: number; st?: number; step?: number;
    onChange: (v: number) => void;
  }) => (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm" style={{ color: 'var(--oa-ink)' }}>
          <IonIcon icon={icon} style={{ color: 'var(--oa-honey-600)' }} /> {label}
        </span>
        <span className="oa-mono text-sm font-semibold" style={{ color: 'var(--oa-ink)' }}>{fmtDuration(value)}</span>
      </div>
      <IonRange min={min} max={max} step={st} value={value}
        onIonInput={(e) => onChange(e.detail.value as number)} />
    </div>
  );

  return (
    <IonModal isOpen={isOpen} onDidDismiss={close} initialBreakpoint={1} breakpoints={[0, 1]}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Intervals · {deviceName}</IonTitle>
          <IonButtons slot="end"><IonButton onClick={close}>Close</IonButton></IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {step === 'connecting' && (
          <div className="flex flex-col items-center gap-3 text-center py-8">
            <IonSpinner name="dots" />
            <p className="oa-muted text-sm">Waiting for {deviceName}'s next heartbeat…</p>
            <p className="oa-numeral text-2xl font-semibold" style={{ color: 'var(--oa-ink)' }}>{elapsed}s</p>
            <p className="oa-subtle text-xs">Scales check in about once a minute. Keep the phone close.</p>
          </div>
        )}

        {step === 'saving' && (
          <div className="flex flex-col items-center gap-3 text-center py-8">
            <IonSpinner name="dots" /><p className="oa-muted text-sm">Saving to the scale…</p>
          </div>
        )}

        {step === 'edit' && (
          <div className="flex flex-col gap-4">
            <div className="oa-card p-4 flex flex-col gap-1">
              <span className="flex items-center gap-2 font-semibold" style={{ color: 'var(--oa-ink)' }}>
                <IonIcon icon={sunnyOutline} style={{ color: 'var(--oa-honey-600)' }} /> On-season (summer)
              </span>
              <Row icon={pulseOutline} label="Heartbeat" value={iv.summerHeartbeatSec}
                min={10} max={300} st={5} onChange={(v) => setIv({ ...iv, summerHeartbeatSec: v })} />
              <Row icon={timeOutline} label="Reading" value={iv.summerReadingSec}
                min={60} max={3600} st={60} onChange={(v) => setIv({ ...iv, summerReadingSec: v })} />
              <span className="oa-subtle text-xs">On-device history holds about {retentionDays(iv.summerReadingSec)} at this reading cadence.</span>
            </div>

            <div className="oa-card p-4 flex flex-col gap-1">
              <span className="flex items-center gap-2 font-semibold" style={{ color: 'var(--oa-ink)' }}>
                <IonIcon icon={snowOutline} style={{ color: 'var(--oa-honey-600)' }} /> Off-season (winter)
              </span>
              <Row icon={pulseOutline} label="Heartbeat" value={iv.winterHeartbeatSec}
                min={10} max={300} st={5} onChange={(v) => setIv({ ...iv, winterHeartbeatSec: v })} />
              <Row icon={timeOutline} label="Reading" value={iv.winterReadingSec}
                min={1800} max={10800} st={300} onChange={(v) => setIv({ ...iv, winterReadingSec: v })} />
              <span className="oa-subtle text-xs">On-device history holds about {retentionDays(iv.winterReadingSec)} at this reading cadence.</span>
            </div>

            <p className="oa-subtle text-xs">The scale switches seasons automatically by date (winter = 1&nbsp;Nov–1&nbsp;Mar). Shorter intervals give more detail but use more battery and fill the on-device log faster.</p>
            <IonButton expand="block" onClick={() => { void save(); }}>Save to scale</IonButton>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center gap-3 text-center py-8">
            <IonLabel color="success" className="text-lg font-semibold">Intervals saved</IonLabel>
            <p className="oa-muted text-sm">The scale will use the new cadences from its next cycle.</p>
            <IonButton expand="block" onClick={close}>Done</IonButton>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col items-center gap-3 text-center py-8">
            <p className="oa-muted text-sm">{error}</p>
            <IonButton expand="block" fill="outline" onClick={close}>Close</IonButton>
          </div>
        )}
      </IonContent>
    </IonModal>
  );
};

export default IntervalsWizard;
