import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonBackButton, IonButtons, IonItem, IonLabel, IonInput, IonToggle,
  IonButton, IonList,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { loadSettings, saveSettings, type Settings } from '../lib/settings';

const SettingsPage: React.FC = () => {
  const [s, setS] = useState<Settings | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => { void loadSettings().then(setS); }, []);

  if (!s) return null;

  async function save() {
    await saveSettings(s!);
    setSavedAt(Date.now());
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
        </div>
      </IonContent>
    </IonPage>
  );
};

export default SettingsPage;
