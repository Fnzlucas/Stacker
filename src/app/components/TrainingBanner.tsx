import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { needsTraining } from '../lib/roleplay';
import { useRoleplay } from '../lib/roleplayQueries';
import { PATHS } from '../paths';

/** Bandeau de l'écran de signature quand l'entraînement est exigé et pas encore réussi. */
export function TrainingBanner(): ReactElement | null {
  const state = useRoleplay();
  if (!needsTraining(state.data)) return null;
  return (
    <div className="card card-hero sub-banner" role="status">
      <Icon name="mic" />
      <p>Réussis une simulation d’appel avant ta première signature.</p>
      <Link className="btn btn-accent btn-sm" to={PATHS.training}>
        S’entraîner
      </Link>
    </div>
  );
}
