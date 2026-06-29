// Empty state: honeycomb illustration + a clear, calm call to action
// (style guide §11.4). Used when there are no hives / no readings yet.

import { IonButton } from '@ionic/react';
import type { ReactNode } from 'react';
import Logo from './Logo';

interface Props {
  title: string;
  message?: ReactNode;
  ctaLabel?: string;
  onCta?: () => void;
  ctaHref?: string;
}

export default function EmptyState({ title, message, ctaLabel, onCta, ctaHref }: Props) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 px-6 py-14">
      <Logo size={88} />
      <h2 className="text-xl font-semibold" style={{ color: 'var(--oa-ink)' }}>{title}</h2>
      {message && <p className="text-sm oa-muted max-w-xs">{message}</p>}
      {ctaLabel && (
        <IonButton
          className="ion-margin-top"
          onClick={onCta}
          routerLink={ctaHref}
        >
          {ctaLabel}
        </IonButton>
      )}
    </div>
  );
}
