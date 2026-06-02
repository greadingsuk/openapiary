import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonBackButton, IonButtons, IonItem, IonLabel, IonInput, IonToggle,
  IonButton, IonList,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { loadSettings, saveSettings, type Settings } from '../lib/settings';
import { syncNow, unsyncedCount } from '../lib/sync';

const SettingsPage: React.FC = () => {
  const [s, setS] = useState<Settings | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [unsynced, setUnsynced] = useState<number>(0);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

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
    setSyncMsg('Syncing...');
    const r = await syncNow();
    setSyncMsg(`Synced ${r.succeeded}/${r.attempted}${r.failed.length ? ' - ' + r.failed.join('; ') : ''}`);
    await refreshUnsynced();
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/hives" /></IonButtons>
          <IonTitle>Settings</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonList>
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
            </IonToggle>
          </IonItem>
        </IonList>
        <div className="ion-padding">
          <IonButton expand="block" onClick={save}>Save</IonButton>
          {savedAt && <p>Saved {new Date(savedAt).toLocaleTimeString()}</p>}
          <IonButton expand="block" color="secondary" onClick={runSync} className="ion-margin-top">
            Sync now ({unsynced} pending)
          </IonButton>
          {syncMsg && <p>{syncMsg}</p>}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default SettingsPage;
