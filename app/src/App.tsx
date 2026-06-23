import { Redirect, Route } from 'react-router-dom';
import {
  IonApp, IonIcon, IonLabel, IonRouterOutlet, IonTabBar, IonTabButton,
  IonTabs, setupIonicReact,
} from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { gridOutline, statsChartOutline, settingsOutline } from 'ionicons/icons';
import { useEffect } from 'react';
import HiveListPage from './pages/HiveListPage';
import HiveDetailPage from './pages/HiveDetailPage';
import AddHivePage from './pages/AddHivePage';
import SettingsPage from './pages/SettingsPage';
import FleetPage from './pages/FleetPage';
import { initDb } from './lib/db';
import { startAutoSync, stopAutoSync } from './lib/sync';

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
  useEffect(() => {
    void initDb();
    startAutoSync();
    return () => stopAutoSync();
  }, []);

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
          <Route exact path="/">
            <Redirect to="/hives" />
          </Route>
        </IonRouterOutlet>
        <IonTabBar slot="bottom">
          <IonTabButton tab="hives" href="/hives">
            <IonIcon icon={gridOutline} aria-hidden="true" />
            <IonLabel>Hives</IonLabel>
          </IonTabButton>
          <IonTabButton tab="fleet" href="/fleet">
            <IonIcon icon={statsChartOutline} aria-hidden="true" />
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
