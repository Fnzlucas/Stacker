/**
 * « Installe Stacker sur ton iPhone » : affiché sur l'accueil, dans Safari
 * sur iPhone uniquement (ni dans l'app installée, ni dans l'app App Store).
 * Refermable ; le choix est gardé sur l'appareil.
 */
import { useState, type ReactElement } from 'react';
import { Icon } from '../../components/Icon';
import { canSuggestIosInstall } from '../lib/platform';

const KEY = 'stk-install-hint-closed';

function closedBefore(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function InstallHint({ force = false }: { force?: boolean }): ReactElement | null {
  const [visible, setVisible] = useState(() => (force || canSuggestIosInstall()) && !closedBefore());
  if (!visible) return null;
  const close = () => {
    try {
      window.localStorage.setItem(KEY, '1');
    } catch {
      /* stockage indisponible : on referme quand même */
    }
    setVisible(false);
  };
  return (
    <section className="card install-hint" aria-labelledby="install-title">
      <div className="install-hint-head">
        <h2 id="install-title" className="h3">
          Installe Stacker sur ton iPhone
        </h2>
        <button type="button" className="btn btn-glass btn-sm btn-icon" aria-label="Fermer" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <p className="text-2 text-sm">Une icône sur ton écran d’accueil, l’app en plein écran, en 3 gestes :</p>
      <ol className="install-hint-steps">
        <li>
          <span className="install-hint-num" aria-hidden="true">
            1
          </span>
          <span>
            Touche le bouton <b>Partager</b> <Icon name="arrow-up-right" size={16} /> en bas de Safari.
          </span>
        </li>
        <li>
          <span className="install-hint-num" aria-hidden="true">
            2
          </span>
          <span>
            Choisis <b>Sur l’écran d’accueil</b> <Icon name="plus" size={16} />.
          </span>
        </li>
        <li>
          <span className="install-hint-num" aria-hidden="true">
            3
          </span>
          <span>
            Touche <b>Ajouter</b> : c’est fait.
          </span>
        </li>
      </ol>
    </section>
  );
}
