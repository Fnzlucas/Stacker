import type { ReactElement } from 'react';
import { Link, useLocation } from 'react-router';
import { Icon, type IconName } from '../../components/Icon';
import { Logo, LogoLockup } from '../../components/Logo';
import { Ransom } from '../../components/Ransom';
import { useAuth } from '../auth/AuthProvider';
import { PageHeading, usePageTitle } from '../components/Layouts';
import { PATHS } from '../paths';

const POINTS: { icon: IconName; text: string }[] = [
  { icon: 'map-pin', text: 'L’app trouve les entreprises de ta zone.' },
  { icon: 'phone', text: 'Tu les appelles avec les scripts intégrés.' },
  { icon: 'trending-up', text: 'Elles signent avec Stacker : 15 à 25 % de commission chaque mois, tant qu’elles restent.' },
];

/**
 * Écran d'accueil avant connexion (ouverture de /app sans session) : collage
 * « vox », puis créer un compte ou se connecter. Son entrée démarre quand
 * l'écran de démarrage sort (html.is-booted, voir boot.ts). Aucun montant,
 * aucun compteur.
 */
export function DemarrerPage(): ReactElement {
  usePageTitle('Bienvenue');
  const { backend } = useAuth();
  const location = useLocation();
  // La page demandée avant la connexion suit jusqu'à la connexion ou l'inscription.
  const state: unknown = location.state;

  return (
    <div className="welcome">
      <div className="welcome-paper" aria-hidden="true" />
      <header className="welcome-top wi wi-0">
        <a href="/" className="logo-link" aria-label="Stacker, retour au site">
          <LogoLockup size={30} />
        </a>
        {backend ? (
          <Link className="link welcome-login" to={PATHS.login} state={state}>
            Se connecter
          </Link>
        ) : null}
      </header>

      <main id="contenu" className="welcome-main">
        <div className="welcome-collage" aria-hidden="true">
          <span className="welcome-burst wi wi-1" />
          <span className="welcome-logo wi wi-2">
            <Logo size={88} />
          </span>
          <span className="sticker welcome-stk welcome-stk-1 wi wi-3">
            <Icon name="map-pin" />
            Ta zone
          </span>
          <span className="sticker sticker-violet welcome-stk welcome-stk-2 wi wi-4">
            <Icon name="phone" />
            Tu convaincs
          </span>
          <span className="sticker sticker-orange welcome-stk welcome-stk-3 wi wi-5">
            <Icon name="signature" />
            Ils signent
          </span>
          <span className="sticker sticker-paper sticker-serif welcome-stk welcome-stk-4 wi wi-6">chaque mois</span>
        </div>

        <PageHeading className="welcome-title">
          <Ransom text="Stack tes clients." animated className="welcome-ransom" />
        </PageHeading>
        <p className="lead welcome-lead wi wi-7">Apporteur d’affaires indépendant : tu trouves, tu convaincs, Stacker fait le reste.</p>

        <ul className="welcome-points">
          {POINTS.map((p, i) => (
            <li key={p.icon} className={`wi wi-${String(8 + i)}`}>
              <span className="welcome-point-icon" aria-hidden="true">
                <Icon name={p.icon} />
              </span>
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      </main>

      <div className="welcome-actions wi wi-11">
        {backend ? (
          <>
            <Link className="btn btn-primary btn-block btn-lg" to={PATHS.signup} state={state}>
              Créer mon compte
              <Icon name="arrow-right" />
            </Link>
            <Link className="btn btn-secondary btn-block btn-lg" to={PATHS.login} state={state}>
              J’ai déjà un compte
            </Link>
          </>
        ) : (
          <a className="btn btn-primary btn-block btn-lg" href="/liste-attente">
            Rejoindre la liste d’attente
            <Icon name="arrow-right" />
          </a>
        )}
        <p className="welcome-legal">
          <a href="/cgu">Conditions d’utilisation</a> · <a href="/confidentialite">Confidentialité</a> · <a href="/contact">Aide</a>
        </p>
      </div>
    </div>
  );
}
