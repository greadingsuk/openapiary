import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonBackButton, IonButtons, IonList, IonItem, IonLabel,
  useIonViewWillEnter,
} from '@ionic/react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { getReadings, type HiveReading } from '../lib/api';
import { loadSettings } from '../lib/settings';

const HiveDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [readings, setReadings] = useState<HiveReading[]>([]);
  const [error, setError] = useState<string | null>(null);

  useIonViewWillEnter(() => {
    (async () => {
      try {
        const s = await loadSettings();
        setReadings(await getReadings(s, id));
        setError(null);
      } catch (e: any) {
        setError(e.message ?? String(e));
      }
    })();
  });

  const latest = readings[0];

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/hives" /></IonButtons>
          <IonTitle>{id}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {error && <IonItem color="warning"><IonLabel>{error}</IonLabel></IonItem>}
        {latest && (
          <IonList>
            <IonItem><IonLabel>Weight</IonLabel><IonLabel slot="end">{latest.weight_kg?.toFixed(2) ?? '-'} kg</IonLabel></IonItem>
            <IonItem><IonLabel>Battery</IonLabel><IonLabel slot="end">{latest.battery_v?.toFixed(2) ?? '-'} V</IonLabel></IonItem>
            <IonItem><IonLabel>Temp</IonLabel><IonLabel slot="end">{latest.temp_c?.toFixed(1) ?? '-'} &deg;C</IonLabel></IonItem>
            <IonItem><IonLabel>RSSI</IonLabel><IonLabel slot="end">{latest.rssi ?? '-'} dBm</IonLabel></IonItem>
            <IonItem><IonLabel>Last seen</IonLabel><IonLabel slot="end">{new Date(latest.ts).toLocaleString()}</IonLabel></IonItem>
          </IonList>
        )}
        <h3 className="ion-padding">History ({readings.length})</h3>
        <IonList>
          {readings.map((r, i) => (
            <IonItem key={i}>
              <IonLabel>
                <h3>{r.weight_kg?.toFixed(2) ?? '-'} kg</h3>
                <p>{new Date(r.ts).toLocaleString()}</p>
              </IonLabel>
              <IonLabel slot="end">{r.battery_v?.toFixed(2) ?? '-'} V</IonLabel>
            </IonItem>
          ))}
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default HiveDetailPage;
