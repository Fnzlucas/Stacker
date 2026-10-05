import type { ReactElement } from 'react';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { Ransom } from '../../components/Ransom';

/** Panneau décoratif des écrans d'auth en desktop (sans chiffre ni promesse). */
export function AuthAside(): ReactElement {
  return (
    <div className="balance auth-aside-card">
      <div className="balance-deco" aria-hidden="true">
        <Logo tile={false} size={168} />
      </div>
      <span className="chip chip-on-dark">Apporteurs d’affaires indépendants</span>
      <p className="mt-6">
        <Ransom text="Stack tes clients" className="ransom-sm justify-start" />
      </p>
      <ul className="tick-list mt-8">
        <li>
          <span className="tick" aria-hidden="true">
            <Icon name="check" />
          </span>
          <span>L’app trouve les entreprises de ta zone et te donne les scripts.</span>
        </li>
        <li>
          <span className="tick" aria-hidden="true">
            <Icon name="check" />
          </span>
          <span>Stacker vend et réalise le service ; ton client signe sur son propre téléphone.</span>
        </li>
        <li>
          <span className="tick" aria-hidden="true">
            <Icon name="check" />
          </span>
          <span>De 15 à 25 % de commission récurrente selon ton niveau, tant que ton client reste abonné.</span>
        </li>
      </ul>
    </div>
  );
}
