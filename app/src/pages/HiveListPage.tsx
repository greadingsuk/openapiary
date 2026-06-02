import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonList, IonItem, IonLabel, IonNote, IonButton, IonIcon,
  IonRefresher, IonRefresherContent, useIonViewWillEnter,
} from '@ionic/react';
import { add, settingsOutline } from 'ionicons/icons';
import { useState } from 'react';
import { listHives, type HiveSummary } from '../lib/api';
import { loadSettings } from '../lib/settings';

const HiveListPage: React.FC = () => {
  const [hives, setHives] = useState<HiveSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const s = await loadSettings();
      if (!s.apiKey) { setError('Set API key in Settings'); return; }
      setError(null);
      setHives(await listHives(s));
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }

  useIonViewWillEnter(() => { void load(); });

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Hives</IonTitle>
          <IonButton slot="end" fill="clear" routerLink="/settings">
            <IonIcon icon={settingsOutline} />
          </IonButton>
          <IonButton slot="end" fill="clear" routerLink="/add">
            <IonIcon icon={add} />
          </IonButton>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={async (e) => { await load(); e.detail.complete(); }}>
          <IonRefresherContent />
        </IonRefresher>
        {error && <IonItem color="warning"><IonLabel>{error}</IonLabel></IonItem>}
        <IonList>
          {hives.map((h) => (
            <IonItem key={h.id} routerLink={`/hive/${encodeURIComponent(h.id)}`}>
              <IonLabel>
                <h2>{h.name}</h2>
                <p>{h.id}</p>
              </IonLabel>
              <IonNote slot="end">{new Date(h.created_at).toLocaleDateString()}</IonNote>
            </IonItem>
          ))}
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default HiveListPage;
