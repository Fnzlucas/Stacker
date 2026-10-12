import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { needsSubscription } from '../lib/billing';
import { useBilling } from '../lib/billingQueries';
import { PATHS } from '../paths';

/** Bandeau des écrans de prospection et de vente quand l'abonnement est exigé et pas à jour. */
export function SubscriptionBanner({ what }: { what: string }): ReactElement | null {
  const billing = useBilling();
  if (!needsSubscription(billing.data)) return null;
  return (
    <div className="card card-hero sub-banner" role="status">
      <Icon name="lock" />
      <p>Active ton abonnement pour {what}.</p>
      <Link className="btn btn-accent btn-sm" to={PATHS.billing}>
        Activer
      </Link>
    </div>
  );
}
