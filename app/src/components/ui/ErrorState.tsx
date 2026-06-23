// Error state: calm and actionable, never an alarmist red wall (style guide §11.4).
// Amber-toned card with the problem stated plainly and a retry affordance.

import { IonButton, IonIcon } from '@ionic/react';
import { alertCircleOutline } from 'ionicons/icons';

interface Props {
  title?: string;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export default function ErrorState({ title = 'Something needs attention', message, retryLabel = 'Try again', onRetry }: Props) {
  return (
    <div className="oa-card mx-4 my-4 p-5 flex flex-col items-start gap-2">
      <div className="flex items-center gap-2">
        <IonIcon icon={alertCircleOutline} style={{ color: 'var(--oa-honey-600)', fontSize: 22 }} />
        <h3 className="text-base font-semibold" style={{ color: 'var(--oa-ink)' }}>{title}</h3>
      </div>
      <p className="text-sm oa-muted">{message}</p>
      {onRetry && (
        <IonButton size="small" fill="outline" onClick={onRetry} className="ion-margin-top">
          {retryLabel}
        </IonButton>
      )}
    </div>
  );
}
