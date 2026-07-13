// Test (diagnostic) logging (firmware v1.1.0+). Lets the beekeeper turn on a
// higher-detail on-device log for a scale under investigation, then pull it over
// BLE and export it as CSV for review. This is the "5a" scope: pull-to-app plus
// export/share (no dedicated cloud path yet — the CSV can be shared anywhere).
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSpinner, IonToggle, IonLabel, IonNote, IonItem,
} from '@ionic/react';
import { cloudDownloadOutline, shareOutline } from 'ionicons/icons';
import { useEffect, useRef, useState } from 'react';
import {
  findDeviceId, connectDevice, disconnectDevice,
  readDebugConnected, setDebugConnected, drainDiagnosticsConnected, type DiagRecord,
} from '../lib/ble';

type Step = 'connecting' | 'ready' | 'pulling' | 'error';

interface Props {
  isOpen: boolean;
  deviceName: string;
  onClose: () => void;
}

function toCsv(rows: DiagRecord[]): string {
  const head = 'seq,timestamp,weight_kg,temp_c,spread_g,battery_v';
  const body = rows.map((r) => {
    const ts = r.epoch > 0 ? new Date(r.epoch * 1000).toISOString() : '';
    return [r.seq, ts, r.weightKg.toFixed(2), r.tempC.toFixed(1), r.spreadG, r.batteryV.toFixed(2)].join(',');
  });
  return [head, ...body].join('\n');
}

const TestLoggingModal: React.FC<Props> = ({ isOpen, deviceName, onClose }) => {
  const [step, setStep] = useState<Step>('connecting');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<DiagRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
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
    setError(null); setNote(null); setRows([]); setElapsed(0);
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
        setEnabled(await readDebugConnected(id));
        setStep('ready');
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

  async function toggle(on: boolean) {
    const id = connectedIdRef.current;
    if (!id) return;
    setBusy(true);
    try {
      await setDebugConnected(id, on);
      setEnabled(on);
      setNote(on ? 'Test logging on — the scale will record a diagnostic sample each reading.' : 'Test logging off.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pull() {
    const id = connectedIdRef.current;
    if (!id) return;
    setStep('pulling');
    setNote(null);
    try {
      const recs = await drainDiagnosticsConnected(id, 0);
      setRows(recs);
      setNote(recs.length ? `Pulled ${recs.length} diagnostic sample${recs.length === 1 ? '' : 's'}.` : 'No diagnostic samples on the scale yet.');
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setStep('ready');
    }
  }

  async function exportCsv() {
    if (!rows.length) return;
    const csv = toCsv(rows);
    const filename = `${deviceName}-diagnostics.csv`;
    // Prefer the native/web share sheet; fall back to clipboard.
    try {
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (typeof nav.share === 'function') {
        const file = new File([csv], filename, { type: 'text/csv' });
        if (nav.canShare && nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: filename });
          return;
        }
        await nav.share({ title: filename, text: csv });
        return;
      }
    } catch { /* fall through to clipboard / download */ }
    try {
      await navigator.clipboard.writeText(csv);
      setNote('CSV copied to the clipboard.');
    } catch {
      // Last-resort web download.
      try {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
      } catch {
        setNote('Could not export — copy the preview below manually.');
      }
    }
  }

  return (
    <IonModal isOpen={isOpen} onDidDismiss={close} initialBreakpoint={1} breakpoints={[0, 1]}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Test logging · {deviceName}</IonTitle>
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

        {(step === 'ready' || step === 'pulling') && (
          <div className="flex flex-col gap-4">
            <IonItem lines="none" className="oa-card">
              <IonToggle checked={enabled} disabled={busy || step === 'pulling'}
                onIonChange={(e) => { void toggle(e.detail.checked); }}>
                <IonLabel>Record diagnostics</IonLabel>
                <IonNote color="medium">Logs weight, temperature, sample spread and battery each reading, to a small on-device ring.</IonNote>
              </IonToggle>
            </IonItem>

            <IonButton expand="block" fill="outline" disabled={step === 'pulling'} onClick={() => { void pull(); }}>
              <IonIcon slot="start" icon={cloudDownloadOutline} />
              {step === 'pulling' ? 'Pulling…' : 'Pull diagnostics from scale'}
            </IonButton>

            {rows.length > 0 && (
              <IonButton expand="block" onClick={() => { void exportCsv(); }}>
                <IonIcon slot="start" icon={shareOutline} />
                Export CSV ({rows.length})
              </IonButton>
            )}

            {note && <p className="oa-muted text-sm">{note}</p>}

            {rows.length > 0 && (
              <div className="oa-card p-3">
                <div className="oa-mono text-xs" style={{ whiteSpace: 'pre', overflowX: 'auto', maxHeight: 220 }}>
                  {toCsv(rows.slice(0, 30))}
                  {rows.length > 30 ? `\n… ${rows.length - 30} more` : ''}
                </div>
              </div>
            )}
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

export default TestLoggingModal;
