// A small modal form for creating an apiary. Replaces the two-field IonAlert,
// which forced the user to press Enter on the name before the postcode field
// would accept input. Both fields here are always editable.
import {
  IonModal, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonItem, IonLabel, IonInput, IonNote,
} from '@ionic/react';
import { useEffect, useState } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, location: string) => void;
}

const NewApiaryModal: React.FC<Props> = ({ isOpen, onClose, onCreate }) => {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');

  // Reset fields each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setName('');
      setLocation('');
    }
  }, [isOpen]);

  const canSave = name.trim().length > 0;

  function save() {
    if (!canSave) return;
    onCreate(name.trim(), location.trim());
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
          Name your apiary and where it lives. The location powers the regional map in the admin console.
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
          <IonLabel position="stacked">Postcode or place</IonLabel>
          <IonInput
            value={location}
            placeholder="e.g. CH7 4EL"
            onIonInput={(e) => setLocation(e.detail.value ?? '')}
          />
        </IonItem>
        <IonNote className="block mt-2 text-xs" color="medium">
          Location is optional — you can add it later.
        </IonNote>
        <IonButton expand="block" className="mt-4" disabled={!canSave} onClick={save}>
          Create apiary
        </IonButton>
      </IonContent>
    </IonModal>
  );
};

export default NewApiaryModal;
