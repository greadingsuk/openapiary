import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonBackButton, IonButtons, IonButton, IonList, IonItem, IonLabel,
  IonNote, IonSpinner,
} from '@ionic/react';
import { useEffect, useState } from 'react';
import { startScan, stopScan, type OAAdvert } from '../lib/ble';
import { upsertHive, insertReading } from '../lib/db';
import { syncNow } from '../lib/sync';
import { loadSettings } from '../lib/settings';
import { startBackgroundScan, stopBackgroundScan } from '../lib/backgroundScan';

const AddHivePage: React.FC = () => {
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<Map<string, OAAdvert>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  async function toggleScan() {
    if (scanning) {
      await stopScan();
      await stopBackgroundScan();
      setScanning(false);
      return;
    }
    setError(null);
    setFound(new Map());
    const settings = await loadSettings();
    if (settings.backgroundScan) {
      await startBackgroundScan();
    }
    try {
      await startScan(async (a) => {
        setFound((prev) => {
          const next = new Map(prev);
          next.set(a.deviceId, a);
          return next;
        });
        // Write-through to local SQLite so nothing is ever lost.
        const hiveId = a.deviceName.toLowerCase();
        await upsertHive({ id: hiveId, name: a.deviceName, created_at: Date.now() });
        await insertReading({
          hive_id: hiveId,
          ts: a.ts,
          weight_kg: a.weightKg,
          battery_v: a.batteryV,
          temp_c: a.tempC,
          packet_id: a.packetId,
          rssi: a.rssi,
        });
      });
      setScanning(true);
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }

  useEffect(() => () => { void stopScan(); void stopBackgroundScan(); }, []);

  async function pair(a: OAAdvert) {
    try {
      const hiveId = a.deviceName.toLowerCase();
      // Already cached locally on every advert; just kick a sync.
      const r = await syncNow();
      if (r.failed.length) throw new Error(r.failed.join('; '));
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
