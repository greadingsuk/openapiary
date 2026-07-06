import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonBackButton,
  IonButtons, IonButton, IonIcon, IonProgressBar, IonToast, IonNote, useIonViewWillEnter,
} from '@ionic/react';
import { hardwareChipOutline, checkmarkCircle, cloudDownloadOutline, warningOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { CURRENT_BUILD, latestFirmware, updateFirmware, type FirmwareInfo } from '../lib/ota';
import { readAdvertOnce } from '../lib/ble';
import { latestReading } from '../lib/db';

const normVer = (v: string) => v.trim().toLowerCase().replace(/^v/, '');
const BAT_RECOVERY_THRESHOLD_V = 3.3;

const FirmwarePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const deviceName = id.toUpperCase();
  const [latest, setLatest] = useState<FirmwareInfo | null>(null);
  const [installed, setInstalled] = useState<string>(CURRENT_BUILD);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [phase, setPhase] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [batteryV, setBatteryV] = useState<number | null>(null);
  const [charging, setCharging] = useState<boolean | null>(null);
  const [batterySource, setBatterySource] = useState<'live' | 'cache' | null>(null);

  useIonViewWillEnter(() => {
    setLoadError(null);
    void latestFirmware().then(setLatest).catch((e) =>
      setLoadError(e instanceof Error ? e.message : String(e)),
    );
    // Read the installed version straight from the scale's advert (passive).
    if (Capacitor.isNativePlatform()) {
      void readAdvertOnce(deviceName, 6000).then((a) => {
        if (a?.fwVersion) setInstalled(a.fwVersion);
        if (typeof a?.batteryV === 'number') {
          setBatteryV(a.batteryV);
          setBatterySource('live');
        }
        if (typeof a?.charging === 'boolean') {
          setCharging(a.charging);
        }
      }).catch(() => undefined);
    }
    // Fallback: if we didn't hear a live advert, use the latest cached reading.
    void latestReading(id).then((r) => {
      if (!r) return;
      setBatteryV((cur) => (cur == null && r.battery_v != null ? r.battery_v : cur));
      setBatterySource((cur) => (cur ?? (r.battery_v != null ? 'cache' : null)));
    }).catch(() => undefined);
  });

  const upToDate = !!latest && normVer(latest.version) === normVer(installed);
  const busy = pct != null;
  const batteryKnown = batteryV != null;
  const batteryTooLowForOta = batteryKnown && batteryV < BAT_RECOVERY_THRESHOLD_V;
  const canStartUpdate = !!latest?.zip && !busy && !batteryTooLowForOta;

  async function run() {
    if (!latest) return;
    if (batteryTooLowForOta) {
      setToast(
        `Battery is ${batteryV!.toFixed(2)} V. OTA is blocked below ${BAT_RECOVERY_THRESHOLD_V.toFixed(1)} V. ` +
        'Leave the scale in daylight to charge, then try again.',
      );
      return;
    }
    setPct(0);
    setPhase('Starting');
    try {
      await updateFirmware(deviceName, latest, (p, ph) => { setPct(p); setPhase(ph); });
      setToast('Firmware updated. The scale is restarting on the new version.');
      setInstalled(latest.version);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setPct(null);
    }
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/hives" /></IonButtons>
          <IonTitle>Firmware</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="px-4 py-4 flex flex-col gap-4">
          <div className="oa-card p-5 flex flex-col items-center gap-2">
            <IonIcon icon={hardwareChipOutline} style={{ fontSize: 40, color: 'var(--oa-honey-600)' }} />
            <span className="text-sm oa-muted">Installed on {deviceName}</span>
            <span className="oa-numeral text-2xl font-bold" style={{ color: 'var(--oa-ink)' }}>{installed}</span>
          </div>

          {loadError ? (
            <div className="oa-card p-4 flex items-center gap-2">
              <IonIcon icon={warningOutline} style={{ color: 'var(--ion-color-warning)', fontSize: 22 }} />
              <span className="text-sm oa-muted">Couldn't check for updates: {loadError}</span>
            </div>
          ) : upToDate ? (
            <div className="oa-card p-4 flex items-center gap-2">
              <IonIcon icon={checkmarkCircle} style={{ color: 'var(--ion-color-success)', fontSize: 22 }} />
              <span style={{ color: 'var(--oa-ink)' }}>Up to date</span>
            </div>
          ) : latest && (
            <div className="oa-card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold" style={{ color: 'var(--oa-ink)' }}>{latest.version} available</span>
                <span className="text-xs oa-subtle">{installed} → {latest.version}</span>
              </div>
              {latest.notes && <p className="text-sm oa-muted whitespace-pre-line">{latest.notes}</p>}

              <div className="text-xs oa-muted">
                Battery pre-check:{' '}
                {batteryKnown
                  ? `${batteryV!.toFixed(2)} V${charging == null ? '' : charging ? ' · charging' : ' · not charging'}${batterySource ? ` · ${batterySource}` : ''}`
                  : 'unknown'}
              </div>

              {batteryTooLowForOta && (
                <IonNote className="text-xs" style={{ color: 'var(--ion-color-warning)' }}>
                  Battery is below {BAT_RECOVERY_THRESHOLD_V.toFixed(1)} V. The scale firmware is in low-battery
                  protection and may not enter update mode yet. Leave it in sunlight until battery recovers,
                  then retry.
                </IonNote>
              )}

              {!busy ? (
                <>
                  <IonNote className="text-xs" style={{ color: 'var(--oa-ink)' }}>
                    Before you start: press the scale's button to reboot it. That opens a 60-second
                    window for the update. Keep the app open and the scale nearby.
                  </IonNote>
                  <IonButton expand="block" onClick={run} className="ion-margin-top" disabled={!canStartUpdate}>
                    <IonIcon slot="start" icon={cloudDownloadOutline} /> Update over Bluetooth
                  </IonButton>
                </>
              ) : (
                <div className="pt-2">
                  <IonProgressBar value={pct! / 100} />
                  <p className="text-xs oa-subtle mt-1 text-center">{phase} {pct! > 0 ? `${pct}%` : ''}</p>
                  <p className="text-xs oa-subtle mt-1 text-center">
                    Keep the app open and the scale nearby. If it disconnects, it stays in update
                    mode and the app will retry automatically.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="oa-card p-4 flex flex-col gap-1">
            <span className="text-sm font-semibold" style={{ color: 'var(--oa-ink)' }}>If an update is interrupted</span>
            <p className="text-xs oa-muted">
              The scale can't be bricked by a failed update: its bootloader only runs a fully
              received, validated image. If a transfer stops partway, the scale waits in update
              mode — just start the update again with it nearby.
            </p>
            <p className="text-xs oa-muted">
              As a last resort you can restore it over USB: double-tap the reset button to expose
              the drive, then drag on the recovery <span className="oa-numeral">.uf2</span> file.
            </p>
          </div>
        </div>
        <IonToast isOpen={!!toast} message={toast ?? ''} duration={4500} onDidDismiss={() => setToast(null)} />
      </IonContent>
    </IonPage>
  );
};

export default FirmwarePage;
