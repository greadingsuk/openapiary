import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonBackButton, IonButtons, IonButton, IonList, IonItem, IonLabel,
  IonNote, IonSpinner,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { startScan, stopScan, type OAAdvert } from '../lib/ble';
import { loadSettings } from '../lib/settings';
import { postReadings } from '../lib/api';

const AddHivePage: React.FC = () => {
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<Map<string, OAAdvert>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  async function toggleScan() {
    if (scanning) {
      await stopScan();
      setScanning(false);
      return;
    }
    setError(null);
    setFound(new Map());
    try {
      await startScan((a) => {
        setFound((prev) => {
          const next = new Map(prev);
          next.set(a.deviceId, a);
          return next;
        });
      });
      setScanning(true);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }

  useEffect(() => () => { void stopScan(); }, []);

  async function pair(a: OAAdvert) {
    try {
      const s = await loadSettings();
      if (!s.apiKey) { setError('Set API key in Settings first'); return; }
      const hiveId = a.deviceName.toLowerCase();
      await postReadings(s, hiveId, a.deviceName, [{
        ts: a.ts,
        weightKg: a.weightKg,
        batteryV: a.batteryV,
        tempC: a.tempC,
        packetId: a.packetId,
        rssi: a.rssi,
      }]);
      setSavedId(hiveId);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }

  const adverts = Array.from(found.values()).sort((a, b) => b.rssi - a.rssi);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start"><IonBackButton defaultHref="/hives" /></IonButtons>
          <IonTitle>Add Hive</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonButton expand="block" onClick={toggleScan}>
          {scanning ? 'Stop scan' : 'Start BLE scan'}
        </IonButton>
        {scanning && <IonSpinner className="ion-margin" />}
        {error && <IonItem color="warning"><IonLabel>{error}</IonLabel></IonItem>}
        {savedId && <IonItem color="success"><IonLabel>Paired: {savedId}</IonLabel></IonItem>}
        <IonList>
          {adverts.map((a) => (
            <IonItem key={a.deviceId} button onClick={() => pair(a)}>
              <IonLabel>
                <h2>{a.deviceName}</h2>
                <p>{a.weightKg?.toFixed(2) ?? '-'} kg &middot; {a.batteryV?.toFixed(2) ?? '-'} V</p>
              </IonLabel>
              <IonNote slot="end">{a.rssi} dBm</IonNote>
            </IonItem>
          ))}
        </IonList>
      </IonContent>
    </IonPage>
  );
};

export default AddHivePage;
