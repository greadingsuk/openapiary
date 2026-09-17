// A small modal form for creating an apiary. Replaces the two-field IonAlert,
// which forced the user to press Enter on the name before the postcode field
// would accept input. Both fields here are always editable.
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonItem, IonLabel, IonInput, IonNote, IonIcon,
} from '@ionic/react';
import { locateOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import type { ApiaryMeta } from '../lib/apiaries';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, meta: ApiaryMeta) => void | Promise<void>;
}

const NewApiaryModal: React.FC<Props> = ({ isOpen, onClose, onCreate }) => {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [coordinates, setCoordinates] = useState<{ lat: number; lon: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Reset fields each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setName('');
      setLocation('');
      setCoordinates(null);
      setLocationError(null);
    }
  }, [isOpen]);

  const postcodeValid = /^[A-Z]{1,2}\d[A-Z\d]?$/i.test(location.trim().replace(/\s/g, ''));
  const canSave = name.trim().length > 0 && (postcodeValid || coordinates !== null);

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationError('Location is unavailable. Enter at least the first half of a postcode, such as CH7.');
      return;
    }
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setCoordinates({ lat: coords.latitude, lon: coords.longitude });
        setLocation(`GPS ${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`);
      },
      () => setLocationError('Could not get your phone location. Enter at least the first half of a postcode, such as CH7.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60_000 },
    );
  }

  function save() {
    if (!canSave) return;
    void onCreate(name.trim(), { location: location.trim(), ...(coordinates ?? {}) });
    onClose();
  }

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={1} breakpoints={[0, 1]}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>New apiary</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>Cancel</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <p className="oa-muted text-sm mb-3">
          Give this apiary a name and verified area. This is used to understand seasonal conditions across the UK.
        </p>
        <IonItem>
          <IonLabel position="stacked">Apiary name</IonLabel>
          <IonInput
            value={name}
            placeholder="e.g. Back Garden"
            onIonInput={(e) => setName(e.detail.value ?? '')}
            autofocus
          />
        </IonItem>
        <IonItem className="mt-2">
          <IonLabel position="stacked">Postcode area</IonLabel>
          <IonInput
            value={location}
            placeholder="At least the first half, e.g. CH7"
            onIonInput={(e) => { setLocation(e.detail.value ?? ''); setCoordinates(null); }}
          />
        </IonItem>
        <IonButton fill="outline" expand="block" className="mt-3" onClick={useCurrentLocation}>
          <IonIcon slot="start" icon={locateOutline} /> Use phone location
        </IonButton>
        <IonNote className="block mt-2 text-xs" color={locationError || (!postcodeValid && !coordinates) ? 'danger' : 'medium'}>
          {locationError ?? (coordinates ? 'Phone location captured.' : 'Required: use phone location or enter at least the first half of a postcode.')}
        </IonNote>
        <IonButton expand="block" className="mt-4" disabled={!canSave} onClick={save}>
          Create apiary
        </IonButton>
      </IonContent>
    </IonModal>
  );
};

export default NewApiaryModal;
