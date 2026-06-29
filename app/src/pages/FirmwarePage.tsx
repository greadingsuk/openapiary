import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonBackButton,
  IonButtons, IonButton, IonIcon, IonProgressBar, IonToast, useIonViewWillEnter,
} from '@ionic/react';
import { hardwareChipOutline, checkmarkCircle, cloudDownloadOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CURRENT_BUILD, latestFirmware, updateFirmware, type FirmwareRelease } from '../lib/ota';

const FirmwarePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [latest, setLatest] = useState<FirmwareRelease | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [phase, setPhase] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useIonViewWillEnter(() => { void latestFirmware().then(setLatest); });

  const upToDate = latest && latest.version === CURRENT_BUILD;

  async function run() {
    if (!latest) return;
    setPct(0);
    try {
      await updateFirmware(id.toUpperCase(), (p, ph) => { setPct(p); setPhase(ph); });
      setToast('Firmware updated. The scale will restart.');
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
            <span className="text-sm oa-muted">Installed</span>
            <span className="oa-numeral text-2xl font-bold" style={{ color: 'var(--oa-ink)' }}>{CURRENT_BUILD}</span>
          </div>

          {upToDate ? (
            <div className="oa-card p-4 flex items-center gap-2">
              <IonIcon icon={checkmarkCircle} style={{ color: 'var(--ion-color-success)', fontSize: 22 }} />
              <span style={{ color: 'var(--oa-ink)' }}>Up to date</span>
            </div>
          ) : latest && (
            <div className="oa-card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold" style={{ color: 'var(--oa-ink)' }}>{latest.version} available</span>
                <span className="text-xs oa-subtle">{CURRENT_BUILD} → {latest.version}</span>
              </div>
              <p className="text-sm oa-muted">{latest.notes}</p>
              {pct == null ? (
                <IonButton expand="block" onClick={run} className="ion-margin-top">
                  <IonIcon slot="start" icon={cloudDownloadOutline} /> Update over Bluetooth
                </IonButton>
              ) : (
                <div className="pt-2">
                  <IonProgressBar value={pct / 100} />
                  <p className="text-xs oa-subtle mt-1 text-center">{phase} {pct}%</p>
                </div>
              )}
            </div>
          )}
          <p className="text-xs oa-subtle text-center px-4">
            Keep the scale within range and the app open. Updates apply during the scale's pairing window after a reboot.
          </p>
        </div>
        <IonToast isOpen={!!toast} message={toast ?? ''} duration={3500} onDidDismiss={() => setToast(null)} />
      </IonContent>
    </IonPage>
  );
};

export default FirmwarePage;
