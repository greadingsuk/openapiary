import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
  IonItem, IonLabel, IonToggle,
  IonButton, IonList, IonListHeader, IonNote, IonIcon,
  IonAlert, IonToast,
} from '@ionic/react';
import {
  cloudUploadOutline, checkmarkCircleOutline, personCircleOutline,
  logOutOutline, mailOutline, copyOutline,
} from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { loadSettings, saveSettings, type Settings } from '../lib/settings';
import { syncNow, unsyncedCount } from '../lib/sync';
import { cloneHiveForDemo, isDemoHive, listHivesLocal } from '../lib/db';
import { apiaryOf, loadApiaries, setHiveApiary } from '../lib/apiaries';
import { useOnline } from '../lib/useOnline';
import { useAuth, signOut, addCredentials } from '../lib/auth';
import { APP_VERSION } from '../version';
import { CURRENT_BUILD } from '../lib/ota';

const SettingsPage: React.FC = () => {
  const online = useOnline();
  const auth = useAuth();
  const [s, setS] = useState<Settings | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [unsynced, setUnsynced] = useState<number>(0);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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

  async function doUpgrade(email: string, password: string) {
    try {
      await addCredentials((email ?? '').trim(), password ?? '');
      setToast('Email & password added — you can now sign in on any device.');
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
  }

  async function createDemoCopy() {
    if (!s!.apiKey || !s!.syncEnabled) {
      setToast('Turn on cloud sync and save settings before creating a demo copy.');
      return;
    }
    setSyncing(true);
    try {
      const backup = await syncNow();
      if (backup.failed.length) throw new Error(backup.failed.join('; '));
      const realHives = (await listHivesLocal()).filter((hive) => !isDemoHive(hive.id));
      if (realHives.length !== 1) {
        throw new Error('This tool needs exactly one real scale in this app.');
      }
      const source = realHives[0];
      const demoId = `demo-${source.id}`;
      const copied = await cloneHiveForDemo(source, demoId, `${source.name} (demo)`);
      const apiaries = await loadApiaries();
      await setHiveApiary(demoId, apiaryOf(apiaries, source.id));
      setToast(`Cloud backup confirmed. Created a local demo scale with ${copied} readings.`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  const isAnonymous = auth.email === null;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Settings</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {/* Account */}
        <IonList inset>
          <IonListHeader><IonLabel>Account</IonLabel></IonListHeader>
          <IonItem>
            <IonIcon slot="start" icon={personCircleOutline} style={{ color: 'var(--oa-honey-600)' }} />
            <IonLabel>
              <h2>{isAnonymous ? 'Guest account' : auth.email}</h2>
              <p className="oa-subtle">
                {isAnonymous
                  ? 'Add an email & password to sync across devices'
                  : 'Signed in — your hives follow you on any device'}
              </p>
            </IonLabel>
          </IonItem>
          {isAnonymous && (
            <IonItem button detail onClick={() => setShowUpgrade(true)}>
              <IonIcon slot="start" icon={mailOutline} />
              <IonLabel>Add email & password</IonLabel>
            </IonItem>
          )}
          <IonItem button detail={false} onClick={() => { void signOut(); }}>
            <IonIcon slot="start" icon={logOutOutline} color="danger" />
            <IonLabel color="danger">Sign out</IonLabel>
          </IonItem>
        </IonList>

        {/* Sync */}
        <IonList inset>
          <IonListHeader><IonLabel>Sync</IonLabel></IonListHeader>
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

        {/* Scanning */}
        <IonList inset>
          <IonListHeader><IonLabel>Scanning</IonLabel></IonListHeader>
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

        {/* Diagnostics */}
        <IonList inset>
          <IonListHeader><IonLabel>Diagnostics</IonLabel></IonListHeader>
          <IonItem>
            <IonToggle
              checked={s.verboseLogging}
              onIonChange={(e) => setS({ ...s, verboseLogging: e.detail.checked })}
            >
              <IonLabel>Verbose logging</IonLabel>
              <IonNote color="medium">
                Sends BLE scan/sync activity to Open Apiary support so an issue can be
                diagnosed without you needing to reproduce it live. Off by default.
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

        <IonList inset>
          <IonListHeader><IonLabel>UI testing</IonLabel></IonListHeader>
          <IonItem>
            <IonLabel>
              <h2>Demo scale</h2>
              <p className="oa-subtle">Creates a local copy of your one real scale and its history. Demo readings never upload.</p>
            </IonLabel>
          </IonItem>
          <IonItem button detail={false} disabled={syncing} onClick={() => { void createDemoCopy(); }}>
            <IonIcon slot="start" icon={copyOutline} />
            <IonLabel>Back up and create demo copy</IonLabel>
          </IonItem>
        </IonList>

        {/* About */}
        <IonList inset>
          <IonListHeader><IonLabel>About</IonLabel></IonListHeader>
          <IonItem>
            <IonLabel>App version</IonLabel>
            <IonNote slot="end" className="oa-mono">{APP_VERSION}</IonNote>
          </IonItem>
          <IonItem>
            <IonLabel>Firmware target</IonLabel>
            <IonNote slot="end" className="oa-mono">{CURRENT_BUILD}</IonNote>
          </IonItem>
        </IonList>

        <IonAlert
          isOpen={showUpgrade}
          onDidDismiss={() => setShowUpgrade(false)}
          header="Add email & password"
          message="This turns your guest account into a full one so you can sign in on other devices."
          inputs={[
            { name: 'email', type: 'email', placeholder: 'Email' },
            { name: 'password', type: 'password', placeholder: 'Password (8+ characters)' },
          ]}
          buttons={[
            { text: 'Cancel', role: 'cancel' },
            { text: 'Save', handler: (d) => { void doUpgrade(d.email, d.password); } },
          ]}
        />
        <IonToast isOpen={!!toast} message={toast ?? ''} duration={3500} onDidDismiss={() => setToast(null)} />
      </IonContent>
    </IonPage>
  );
};

export default SettingsPage;
