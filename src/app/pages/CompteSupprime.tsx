import type { ReactElement } from 'react';
import { Icon } from '../../components/Icon';
import { AuthLayout, PageHeading, usePageTitle } from '../components/Layouts';

export function CompteSupprimePage(): ReactElement {
  usePageTitle('Compte supprimé');
  return (
    <AuthLayout>
      <div className="auth-icon" aria-hidden="true">
        <Icon name="check" size={28} />
      </div>
      <PageHeading>Ton compte a été supprimé</PageHeading>
      <div className="card card-hero auth-card">
        <p className="text-2">
          Ton profil, tes consentements et ton inscription à la liste d’attente ont été effacés. Tu as été déconnecté de cet appareil ; les autres appareils
          perdent l’accès au plus tard à l’expiration de leur session (1 heure).
        </p>
        <a className="btn btn-primary btn-block btn-lg" href="/">
          Retour au site
        </a>
      </div>
    </AuthLayout>
  );
}
