import { Redirect, Route } from 'react-router-dom';
import {
  IonApp, IonIcon, IonLabel, IonRouterOutlet, IonSpinner, IonTabBar, IonTabButton,
  IonTabs, setupIonicReact,
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { settingsOutline } from 'ionicons/icons';
import { HiveIcon, FleetIcon } from './components/ui/HiveIcon';
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import HiveListPage from './pages/HiveListPage';
import HiveDetailPage from './pages/HiveDetailPage';
import AddHivePage from './pages/AddHivePage';
import SettingsPage from './pages/SettingsPage';
import FleetPage from './pages/FleetPage';
import AuthPage from './pages/AuthPage';
import FirmwarePage from './pages/FirmwarePage';
import { initDb } from './lib/db';
import { startAutoSync, stopAutoSync } from './lib/sync';
import { initAuth, useAuth } from './lib/auth';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/**
 * Ionic Dark Mode
 * -----------------------------------------------------
 * For more info, please see:
 * https://ionicframework.com/docs/theming/dark-mode
 */

/* import '@ionic/react/css/palettes/dark.always.css'; */
/* import '@ionic/react/css/palettes/dark.class.css'; */
import '@ionic/react/css/palettes/dark.system.css';

/* Theme variables */
import './theme/variables.css';
import './theme/tailwind.css';

setupIonicReact();

const App: React.FC = () => {
  const auth = useAuth();

  useEffect(() => {
    void (async () => {
      await initDb();
      // Browser preview: seed mock hives + auto-login so the UI is reviewable
      // without a backend, BLE, or sign-in. Stripped from native builds.
      if (import.meta.env.DEV && Capacitor.getPlatform() === 'web') {
        const { seedDevData } = await import('./lib/devSeed');
        await seedDevData();
      }
      await initAuth();
      // Hide the native splash once the first screen is ready.
      if (Capacitor.isNativePlatform()) {
        const { SplashScreen } = await import('@capacitor/splash-screen');
        await SplashScreen.hide().catch(() => undefined);
        // Dark header → light status-bar text.
        try {
          const { StatusBar, Style } = await import('@capacitor/status-bar');
          await StatusBar.setStyle({ style: Style.Dark });
          if (Capacitor.getPlatform() === 'android') {
            await StatusBar.setBackgroundColor({ color: '#000000' });
          }
        } catch { /* status bar plugin optional */ }
      }
    })();
  }, []);

  // Auto-sync only runs while signed in.
  useEffect(() => {
    if (auth.authed) {
      startAutoSync();
      return () => stopAutoSync();
    }
  }, [auth.authed]);

  // Hold the first paint until we know whether the user is signed in,
  // so we never flash the welcome screen at a returning user.
  if (!auth.ready) {
    return (
      <IonApp>
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', background: 'var(--oa-surface-base, #fffdf7)',
          }}
        >
          <IonSpinner name="dots" />
        </div>
      </IonApp>
    );
  }

  // Auth screen is a single view — render it directly (NOT inside an
  // IonRouterOutlet, which won't render a pathless route → blank screen).
  if (!auth.authed) {
    return (
      <IonApp>
        <AuthPage />
      </IonApp>
    );
  }

  return (
  <IonApp>
    <IonReactRouter>
      <IonTabs>
        <IonRouterOutlet>
          <Route exact path="/hives" component={HiveListPage} />
          <Route exact path="/fleet" component={FleetPage} />
          <Route exact path="/add" component={AddHivePage} />
          <Route exact path="/settings" component={SettingsPage} />
          <Route exact path="/hive/:id" component={HiveDetailPage} />
          <Route exact path="/hive/:id/firmware" component={FirmwarePage} />
          <Route exact path="/">
            <Redirect to="/hives" />
          </Route>
        </IonRouterOutlet>
        <IonTabBar slot="bottom">
          <IonTabButton tab="hives" href="/hives">
            <HiveIcon size={24} />
            <IonLabel>Hives</IonLabel>
          </IonTabButton>
          <IonTabButton tab="fleet" href="/fleet">
            <FleetIcon size={24} />
            <IonLabel>Fleet</IonLabel>
          </IonTabButton>
          <IonTabButton tab="settings" href="/settings">
            <IonIcon icon={settingsOutline} aria-hidden="true" />
            <IonLabel>Settings</IonLabel>
          </IonTabButton>
        </IonTabBar>
      </IonTabs>
    </IonReactRouter>
  </IonApp>
  );
};

export default App;
