import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonBackButton,
  IonButtons, IonButton, IonIcon, IonProgressBar, IonToast, useIonViewWillEnter,
} from '@ionic/react';
import {
  hardwareChipOutline, checkmarkCircle, cloudDownloadOutline, warningOutline,
  chevronForwardOutline, chevronDownOutline, locationOutline, phonePortraitOutline,
  timeOutline, batteryHalfOutline, sparklesOutline,
} from 'ionicons/icons';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { latestFirmware, updateFirmware, type FirmwareInfo } from '../lib/ota';
import { readAdvertOnce } from '../lib/ble';
import { latestReading } from '../lib/db';
import { loadDeviceMeta, recordDeviceMeta } from '../lib/deviceMeta';

const normVer = (v: string) => v.trim().toLowerCase().replace(/^v/, '');
// An update is power-hungry, so require healthy battery headroom before we start
// (well above the firmware's own low-battery protection).
const OTA_MIN_BATTERY_V = 3.6;

// Turn the internal progress phases into plain, friendly words.
function phaseLabel(phase: string): string {
  switch (phase) {
    case 'Downloading': return 'Downloading update';
    case 'Checking download': return 'Checking the download';
    case 'Waiting for scale': return 'Waiting for the scale';
    case 'Entering update mode': return 'Getting the scale ready';
    case 'Preparing':
    case 'Sending init packet': return 'Getting ready';
    case 'Uploading': return 'Installing';
    case 'Verifying':
    case 'Activating': return 'Finishing up';
    case 'Confirming update': return 'Confirming';
    case 'Done':
    case 'Installed': return 'Done';
    default: return phase || 'Working';
  }
}

type Result =
  | { ok: true; version: string; confirmed: boolean }
  | { ok: false; message: string };

const FirmwarePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const deviceName = id.toUpperCase();
  const [latest, setLatest] = useState<FirmwareInfo | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [phase, setPhase] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [batteryV, setBatteryV] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useIonViewWillEnter(() => {
    setLoadError(null);
    setChecking(true);
    setResult(null);
    void latestFirmware().then(setLatest).catch((e) =>
      setLoadError(e instanceof Error ? e.message : String(e)),
    );
    void loadDeviceMeta().then((store) => {
      const fw = store[id.toLowerCase()]?.fw;
      if (fw) setInstalled((cur) => cur ?? fw);
    }).catch(() => undefined);
    if (Capacitor.isNativePlatform()) {
      void readAdvertOnce(deviceName, 6000).then((a) => {
        if (a?.fwVersion) {
          setInstalled(a.fwVersion);
          void recordDeviceMeta(id, { fw: a.fwVersion });
        }
        if (typeof a?.batteryV === 'number') setBatteryV(a.batteryV);
      }).catch(() => undefined).finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
    void latestReading(id).then((r) => {
      if (!r) return;
      setBatteryV((cur) => (cur == null && r.battery_v != null ? r.battery_v : cur));
    }).catch(() => undefined);
  });

  const versionKnown = installed != null;
  const upToDate = !!latest && versionKnown && normVer(latest.version) === normVer(installed!);
  const busy = pct != null;
  const batteryKnown = batteryV != null;
  const batteryTooLow = batteryKnown && batteryV < OTA_MIN_BATTERY_V;
  const canStartUpdate = !!latest?.zip && !busy && !batteryTooLow;

  async function run() {
    if (!latest) return;
    if (batteryTooLow) {
      setToast("The scale's battery is a bit low to update safely. Leave it in daylight or on a charger for a while, then try again.");
      return;
    }
    setResult(null);
    setPct(0);
    setPhase('Starting');
    if (Capacitor.isNativePlatform()) { try { await KeepAwake.keepAwake(); } catch { /* best effort */ } }
    try {
      const { confirmedVersion } = await updateFirmware(
        deviceName, latest, (p, ph) => { setPct(p); setPhase(ph); },
      );
      const v = confirmedVersion ?? latest.version;
      setInstalled(v);
      if (Capacitor.isNativePlatform()) void recordDeviceMeta(id, { fw: v });
      setResult({ ok: true, version: v, confirmed: !!confirmedVersion });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setPct(null);
      if (Capacitor.isNativePlatform()) { try { await KeepAwake.allowSleep(); } catch { /* best effort */ } }
    }
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/hives" /></IonButtons>
          <IonTitle>Software update</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="px-4 py-4 flex flex-col gap-4">

          {/* Status hero */}
          <div className="oa-card p-5 flex flex-col items-center gap-2">
            <IonIcon icon={hardwareChipOutline} style={{ fontSize: 40, color: 'var(--oa-honey-600)' }} />
            <span className="text-sm oa-muted">Your hive scale ({deviceName})</span>
            <span className="oa-numeral text-2xl font-bold" style={{ color: 'var(--oa-ink)' }}>
              {installed ?? (checking ? 'Checking…' : 'Not heard yet')}
            </span>
            {!versionKnown && !checking && (
              <span className="text-xs oa-subtle text-center">
                We couldn't hear the scale. Bring the phone close and reopen this screen.
              </span>
            )}
          </div>

          {/* Outcome of a just-finished update */}
          {result && (
            <div className="oa-card p-5 flex flex-col items-center gap-3 text-center">
              {result.ok ? (
                <>
                  <IonIcon icon={checkmarkCircle} style={{ fontSize: 44, color: 'var(--ion-color-success)' }} />
                  <span className="text-lg font-bold" style={{ color: 'var(--oa-ink)' }}>
                    {result.confirmed ? `Updated to ${result.version}` : 'Update sent'}
                  </span>
                  <span className="text-sm oa-muted">
                    {result.confirmed
                      ? 'Your scale is now running the latest software.'
                      : `The scale is restarting and should show ${result.version} in a moment.`}
                  </span>
                  <IonButton fill="clear" onClick={() => setResult(null)}>Done</IonButton>
                </>
              ) : (
                <>
                  <IonIcon icon={warningOutline} style={{ fontSize: 40, color: 'var(--ion-color-warning)' }} />
                  <span className="text-base font-bold" style={{ color: 'var(--oa-ink)' }}>Update didn't finish</span>
                  <span className="text-sm oa-muted">{result.message}</span>
                  <span className="text-xs oa-subtle">
                    Your scale is safe — it can't be harmed by a stopped update. Stand close and try again.
                  </span>
                  <IonButton onClick={() => { setResult(null); void run(); }} disabled={!canStartUpdate}>Try again</IonButton>
                </>
              )}
            </div>
          )}

          {/* When busy: progress only */}
          {busy && (
            <div className="oa-card p-5 flex flex-col gap-3">
              <span className="text-base font-bold text-center" style={{ color: 'var(--oa-ink)' }}>
                {phaseLabel(phase)}{pct! > 0 ? ` · ${pct}%` : ''}
              </span>
              <IonProgressBar value={pct! > 0 ? pct! / 100 : undefined} type={pct! > 0 ? 'determinate' : 'indeterminate'} />
              <p className="text-sm text-center" style={{ color: 'var(--oa-ink)' }}>
                <strong>Keep the phone right next to the scale and this screen open.</strong>
              </p>
              <p className="text-xs oa-subtle text-center">
                It can take a minute or two, and the scale can't be harmed. Please don't lock the phone or leave the app.
              </p>
            </div>
          )}

          {/* Not busy, no result: the check result / update offer */}
          {!busy && !result && (
            loadError ? (
              <div className="oa-card p-4 flex items-center gap-2">
                <IonIcon icon={warningOutline} style={{ color: 'var(--ion-color-warning)', fontSize: 22 }} />
                <span className="text-sm oa-muted">We couldn't check for updates just now. Try again shortly.</span>
              </div>
            ) : upToDate ? (
              <div className="oa-card p-4 flex items-center gap-2">
                <IonIcon icon={checkmarkCircle} style={{ color: 'var(--ion-color-success)', fontSize: 22 }} />
                <span style={{ color: 'var(--oa-ink)' }}>You're on the latest software.</span>
              </div>
            ) : latest && (
              <div className="flex flex-col gap-4">

                {/* Instructions FIRST */}
                <div className="oa-card p-4 flex flex-col gap-3" style={{ border: '2px solid var(--oa-honey-400)' }}>
                  <span className="font-bold text-base" style={{ color: 'var(--oa-ink)' }}>Before you start</span>
                  <div className="flex items-start gap-3">
                    <IonIcon icon={locationOutline} style={{ color: 'var(--oa-honey-700)', fontSize: 22, marginTop: 1 }} />
                    <span className="text-sm" style={{ color: 'var(--oa-ink)' }}>Stand right next to the hive.</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <IonIcon icon={phonePortraitOutline} style={{ color: 'var(--oa-honey-700)', fontSize: 22, marginTop: 1 }} />
                    <span className="text-sm" style={{ color: 'var(--oa-ink)' }}>Keep this screen open — don't lock the phone or switch apps.</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <IonIcon icon={timeOutline} style={{ color: 'var(--oa-honey-700)', fontSize: 22, marginTop: 1 }} />
                    <span className="text-sm" style={{ color: 'var(--oa-ink)' }}>It takes a minute or two — the scale can't be harmed.</span>
                  </div>
                </div>

                {/* What's new */}
                <div className="oa-card p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold" style={{ color: 'var(--oa-ink)' }}>
                      New version {latest.version}
                    </span>
                    <span className="text-xs oa-subtle">{installed ?? '—'} → {latest.version}</span>
                  </div>
                  {latest.notes && (
                    <div className="flex items-start gap-2">
                      <IonIcon icon={sparklesOutline} style={{ color: 'var(--oa-honey-600)', fontSize: 18, marginTop: 2 }} />
                      <p className="text-sm oa-muted whitespace-pre-line">{latest.notes}</p>
                    </div>
                  )}
                </div>

                {/* Battery, in plain words */}
                <div className="flex items-center gap-2 px-1">
                  <IonIcon
                    icon={batteryHalfOutline}
                    style={{ fontSize: 20, color: batteryTooLow ? 'var(--ion-color-warning)' : 'var(--ion-color-success)' }}
                  />
                  <span className="text-sm" style={{ color: batteryTooLow ? 'var(--ion-color-warning)' : 'var(--oa-ink)' }}>
                    {!batteryKnown ? 'Checking battery…'
                      : batteryTooLow ? 'Battery is low — charge it before updating.'
                      : 'Battery is good for an update.'}
                  </span>
                </div>

                <IonButton
                  expand="block"
                  onClick={run}
                  disabled={!canStartUpdate}
                  style={{ '--padding-top': '18px', '--padding-bottom': '18px' } as React.CSSProperties}
                >
                  <IonIcon slot="start" icon={cloudDownloadOutline} /> Update now
                </IonButton>
              </div>
            )
          )}

          {/* Having trouble — collapsed, plain language */}
          {!busy && (
            <div className="oa-card p-4">
              <button className="w-full flex items-center justify-between" onClick={() => setShowHelp((v) => !v)}>
                <span className="text-sm font-semibold" style={{ color: 'var(--oa-ink)' }}>Having trouble?</span>
                <IonIcon icon={showHelp ? chevronDownOutline : chevronForwardOutline} style={{ color: 'var(--oa-ink-subtle)', fontSize: 20 }} />
              </button>
              {showHelp && (
                <div className="mt-3 flex flex-col gap-2">
                  <p className="text-xs oa-muted">
                    A stopped update can't harm your scale — it simply waits, ready to try again. Stand close, keep this
                    screen open, and tap Update again.
                  </p>
                  <p className="text-xs oa-muted">
                    If it still won't update, turn the phone's Bluetooth off and on, then retry. As a last resort the
                    scale can be restored with a cable — just ask and we'll walk you through it.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <IonToast
          isOpen={!!toast}
          message={toast ?? ''}
          duration={10000}
          position="middle"
          buttons={[{ text: 'OK', role: 'cancel' }]}
          onDidDismiss={() => setToast(null)}
        />
      </IonContent>
    </IonPage>
  );
};

export default FirmwarePage;
