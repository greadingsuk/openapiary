// First-run authentication: a branded welcome hero with sign-up, sign-in, and a
// frictionless "try it" path. The user never sees an API key — credentials are
// exchanged for a per-device key that's stored silently.

import {
  IonContent, IonPage, IonButton, IonInput, IonItem, IonList,
  IonSpinner, IonText,
} from '@ionic/react';
import { useState } from 'react';
import { signUp, signIn, startAnonymous } from '../lib/auth';
import Honeycomb from '../components/ui/Honeycomb';

type Mode = 'welcome' | 'signup' | 'login';

const AuthPage: React.FC = () => {
  const [mode, setMode] = useState<Mode>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      // On success the auth store flips `authed` and App swaps to the tabs.
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const isForm = mode !== 'welcome';

  return (
    <IonPage>
      <IonContent>
        <div className="flex flex-col items-center min-h-full px-6 pt-16 pb-10">
          {/* Brand hero */}
          <Honeycomb size={96} fillFraction={0.6} />
          <h1 className="oa-numeral text-3xl font-bold mt-4" style={{ color: 'var(--oa-honey-700)' }}>
            Open Apiary
          </h1>
          <p className="text-sm oa-muted mt-1 text-center max-w-xs">
            Your hives, weighed and watched — calmly, from anywhere.
          </p>

          <div className="w-full max-w-sm mt-10">
            {!isForm && (
              <div className="flex flex-col gap-3">
                <IonButton expand="block" onClick={() => setMode('signup')}>
                  Create account
                </IonButton>
                <IonButton expand="block" fill="outline" onClick={() => setMode('login')}>
                  Sign in
                </IonButton>
                <IonButton
                  expand="block"
                  fill="clear"
                  disabled={busy}
                  onClick={() => run(startAnonymous)}
                >
                  {busy ? <IonSpinner name="dots" /> : 'Try it without an account'}
                </IonButton>
              </div>
            )}

            {isForm && (
              <>
                <IonList inset>
                  <IonItem>
                    <IonInput
                      label="Email"
                      labelPlacement="stacked"
                      type="email"
                      autocomplete="email"
                      value={email}
                      onIonInput={(e) => setEmail(e.detail.value ?? '')}
                    />
                  </IonItem>
                  <IonItem>
                    <IonInput
                      label="Password"
                      labelPlacement="stacked"
                      type="password"
                      autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      value={password}
                      onIonInput={(e) => setPassword(e.detail.value ?? '')}
                    />
                  </IonItem>
                </IonList>

                {mode === 'signup' && (
                  <p className="text-xs oa-subtle px-4 -mt-1 mb-2">
                    At least 8 characters. Your email signs you in on any device.
                  </p>
                )}

                <div className="px-4">
                  <IonButton
                    expand="block"
                    disabled={busy || !email || !password}
                    onClick={() =>
                      run(() =>
                        mode === 'signup' ? signUp(email, password) : signIn(email, password),
                      )
                    }
                  >
                    {busy ? <IonSpinner name="dots" /> : mode === 'signup' ? 'Create account' : 'Sign in'}
                  </IonButton>
                  <IonButton
                    expand="block"
                    fill="clear"
                    disabled={busy}
                    onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(null); }}
                  >
                    {mode === 'signup' ? 'I already have an account' : 'Create a new account'}
                  </IonButton>
                  <IonButton
                    expand="block"
                    fill="clear"
                    size="small"
                    disabled={busy}
                    onClick={() => { setMode('welcome'); setError(null); }}
                  >
                    Back
                  </IonButton>
                </div>
              </>
            )}

            {error && (
              <IonText color="danger">
                <p className="text-sm text-center mt-3">{error}</p>
              </IonText>
            )}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default AuthPage;
