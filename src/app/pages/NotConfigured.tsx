import type { ReactElement } from 'react';
import { FormAlert } from '../components/Form';
import { AuthLayout, PageHeading, usePageTitle } from '../components/Layouts';

/** Site déployé sans Supabase : l'app est fermée proprement, avec un message. */
export function NotConfigured(): ReactElement {
  usePageTitle('Bientôt disponible');
  return (
    <AuthLayout>
      <span className="eyebrow">Espace stacker</span>
      <PageHeading>Bientôt disponible</PageHeading>
      <div className="card card-hero auth-card">
        <FormAlert tone="info">L’espace stacker n’est pas encore ouvert sur ce site. Inscris-toi sur la liste d’attente pour être prévenu de l’ouverture.</FormAlert>
        <a className="btn btn-primary btn-block btn-lg" href="/liste-attente">
          Rejoindre la liste d’attente
        </a>
      </div>
    </AuthLayout>
  );
}
