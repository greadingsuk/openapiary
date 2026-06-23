import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonItem, IonLabel, IonInput, IonToggle,
  IonButton, IonList, IonListHeader, IonNote, IonIcon,
} from '@ionic/react';
import { cloudUploadOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { loadSettings, saveSettings, type Settings } from '../lib/settings';
import { syncNow, unsyncedCount } from '../lib/sync';
import { useOnline } from '../lib/useOnline';

const SettingsPage: React.FC = () => {
  const online = useOnline();
  const [s, setS] = useState<Settings | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [unsynced, setUnsynced] = useState<number>(0);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function refreshUnsynced() {
    try { setUnsynced(await unsyncedCount()); } catch { /* noop */ }
  }

  useEffect(() => {
    void loadSettings().then(setS);
    void refreshUnsynced();
  }, []);

  if (!s) return null;

  async function save() {
    await saveSettings(s!);
    setSavedAt(Date.now());
  }

  async function runSync() {
    setSyncing(true);
    setSyncMsg('Syncing…');
    const r = await syncNow();
    setSyncMsg(`Synced ${r.succeeded}/${r.attempted}${r.failed.length ? ' — ' + r.failed.join('; ') : ''}`);
    await refreshUnsynced();
    setSyncing(false);
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Settings</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonList inset>
          <IonListHeader>
            <IonLabel>Cloud connection</IonLabel>
          </IonListHeader>
          <IonItem>
            <IonInput
              label="API URL"
              labelPlacement="stacked"
              value={s.apiUrl}
              onIonInput={(e) => setS({ ...s, apiUrl: e.detail.value ?? '' })}
            />
          </IonItem>
          <IonItem>
            <IonInput
              label="API Key"
              labelPlacement="stacked"
              type="password"
              value={s.apiKey}
              onIonInput={(e) => setS({ ...s, apiKey: e.detail.value ?? '' })}
            />
          </IonItem>
          <IonItem>
            <IonToggle
              checked={s.syncEnabled}
              onIonChange={(e) => setS({ ...s, syncEnabled: e.detail.checked })}
            >
              <IonLabel>Sync to cloud</IonLabel>
              <IonNote color="medium">Back up readings so they survive a phone wipe.</IonNote>
            </IonToggle>
          </IonItem>
        </IonList>

        <IonList inset>
          <IonListHeader>
            <IonLabel>Scanning</IonLabel>
          </IonListHeader>
          <IonItem>
            <IonToggle
              checked={s.backgroundScan}
              onIonChange={(e) => setS({ ...s, backgroundScan: e.detail.checked })}
            >
              <IonLabel>Background scanning (Android)</IonLabel>
              <IonNote color="medium">
                Keeps listening for hive heartbeats with the screen off. Shows a persistent notification.
              </IonNote>
            </IonToggle>
          </IonItem>
        </IonList>

        <div className="ion-padding">
          <IonButton expand="block" onClick={save}>Save settings</IonButton>
          {savedAt && (
            <p className="oa-muted text-sm flex items-center gap-1 mt-2">
              <IonIcon icon={checkmarkCircleOutline} />
              Saved {new Date(savedAt).toLocaleTimeString()}
            </p>
          )}

          <IonButton
            expand="block"
            fill="outline"
            onClick={runSync}
            disabled={syncing || !online}
            className="ion-margin-top"
          >
            <IonIcon slot="start" icon={cloudUploadOutline} />
            Sync now ({unsynced} pending)
          </IonButton>
          {!online && <p className="oa-subtle text-xs mt-2">You're offline — readings will sync automatically when you reconnect.</p>}
          {syncMsg && <p className="oa-muted text-sm mt-2">{syncMsg}</p>}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default SettingsPage;
