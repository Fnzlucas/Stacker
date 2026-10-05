import { useState, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router';
import { Icon } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { PageHeading, usePageTitle } from '../components/Layouts';
import { LevelPill, ProgressBar, Toast } from '../components/Ui';
import { profileChecklist } from '../lib/api';
import { initials, todayLabel } from '../lib/dates';
import { useProfile, useTiers } from '../lib/queries';
import { tierProgress } from '../lib/tiers';
import { PATHS } from '../paths';
import { formatInteger, plural } from '../../lib/format';

const TONE = { rookie: 'green', pro: 'violet', legend: 'pink', elite: 'orange' } as const;

export function AccueilPage(): ReactElement {
  usePageTitle('Accueil');
  const location = useLocation();
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null);
  const profile = useProfile();
  const tiers = useTiers();
  // AppShell garantit un profil chargé.
  const p = profile.data;
  if (!p) return <></>;
  const progress = tiers.data ? tierProgress(tiers.data, p.tier, p.active_clients) : null;
  const checklist = profileChecklist(p);
  const todo = checklist.filter((c) => !c.done).length;

  return (
    <div className="app-container home">
      <header className="home-header">
        <span className="avatar avatar-dark avatar-round home-avatar" aria-hidden="true">
          {initials(p.first_name, p.last_name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{todayLabel(new Date())}</p>
          <PageHeading className="home-title">Bonjour {p.first_name ?? ''}</PageHeading>
        </div>
      </header>

      {p.launch_priority ? (
        <p className="chip chip-green home-priority">
          <Icon name="check" />
          Priorité de lancement conservée (liste d’attente)
        </p>
      ) : null}

      <section className="balance home-balance" aria-labelledby="commissions-title">
        <div className="balance-deco" aria-hidden="true">
          <Logo tile={false} size={168} />
        </div>
        <h2 id="commissions-title" className="balance-label">
          <Icon name="wallet" size={20} />
          Commissions acquises
        </h2>
        <p className="home-balance-empty">Aucune pour l’instant</p>
        <p className="home-balance-text">
          Elles apparaîtront ici dès qu’un client que tu as apporté signera. Disponibles après l’encaissement et le délai prévu, puis virées chaque semaine.
        </p>
        <div className="balance-actions home-balance-actions">
          <Link className="btn btn-glass" to={PATHS.gains}>
            Voir les règles
            <Icon name="arrow-right" />
          </Link>
        </div>
      </section>

      <section className="card card-hero home-level" aria-labelledby="level-title">
        {progress ? (
          <>
            <div className="home-level-head">
              <LevelPill tier={progress.current} />
              {progress.next ? (
                <span className="text-small">
                  Prochain : <b className={`level-next level-next-${progress.next.code}`}>{progress.next.label}</b>
                </span>
              ) : null}
            </div>
            <h2 id="level-title" className="home-level-title">
              {progress.next ? (
                <>
                  Encore {formatInteger(progress.remaining)} {plural(progress.remaining, 'client actif', 'clients actifs')} avant{' '}
                  <span className="serif-accent">{progress.next.label}</span>
                </>
              ) : (
                <>
                  Tu es au niveau <span className="serif-accent">maximal</span>
                </>
              )}
            </h2>
            <div className="progress-meta mt-5">
              <span className="text-2 num">
                {formatInteger(progress.done)} / {formatInteger(progress.target)} {plural(progress.target, 'client actif', 'clients actifs')}
              </span>
              <b className="num">{progress.percent}&nbsp;%</b>
            </div>
            <ProgressBar percent={progress.percent} tone={TONE[progress.current.code]} label={`Progression vers le niveau ${progress.next?.label ?? 'maximal'}`} />
            {progress.provisional ? (
              <p className="form-note mt-4">
                <Icon name="info" />
                <span>Seuils provisoires, confirmés dans le contrat d’apporteur avant l’ouverture des ventes. Un client actif est un client qui paie son abonnement.</span>
              </p>
            ) : null}
          </>
        ) : (
          <div aria-busy="true">
            <h2 id="level-title" className="sr-only">
              Ton niveau
            </h2>
            <span className="skeleton skeleton-title w-40" />
            <span className="skeleton skeleton-text mt-5 w-full" />
            <span className="skeleton skeleton-text mt-3 w-2/3" />
          </div>
        )}
      </section>

      <div className="home-stats">
        <div className="card stat">
          <span className="stat-icon stat-icon-violet" aria-hidden="true">
            <Icon name="star" />
          </span>
          <p className="stat-value num">{formatInteger(p.xp)} XP</p>
          <p className="text-small">Gagnés en formation et en prospection</p>
        </div>
        <div className="card stat">
          <span className="stat-icon stat-icon-green" aria-hidden="true">
            <Icon name="briefcase" />
          </span>
          <p className="stat-value num">
            {formatInteger(p.active_clients)} {plural(p.active_clients, 'client', 'clients')}
          </p>
          <p className="text-small">{plural(p.active_clients, 'Actif', 'Actifs')} ce mois-ci</p>
        </div>
      </div>

      <section aria-labelledby="start-title" className="home-start">
        <div className="section-head">
          <h2 id="start-title" className="h2">
            Pour bien démarrer
          </h2>
          {todo > 0 ? <span className="text-small">{todo} à faire</span> : null}
        </div>
        <ul className="list">
          {checklist.map((item) => (
            <li key={item.key}>
              <Link className={`list-row mission${item.done ? ' is-done' : ''}`} to={PATHS.profile}>
                <span className={`avatar ${item.done ? 'avatar-green' : 'avatar-violet'}`} aria-hidden="true">
                  <Icon name={item.key === 'identity' ? 'user' : item.key === 'zone' ? 'map-pin' : 'building'} />
                </span>
                <span className="list-main">
                  <span className="list-title">{item.label}</span>
                  <span className="list-sub">{item.done ? 'Fait' : 'Dans ton profil'}</span>
                </span>
                <span className={`mission-check${item.done ? ' is-checked' : ''}`} aria-hidden="true">
                  <Icon name="check" />
                </span>
              </Link>
            </li>
          ))}
          <li>
            <div className="list-row mission is-soon">
              <span className="avatar" aria-hidden="true">
                <Icon name="graduation" />
              </span>
              <span className="list-main">
                <span className="list-title">Suivre la formation</span>
                <span className="list-sub">Disponible à l’ouverture</span>
              </span>
              <span className="chip chip-outline">Bientôt</span>
            </div>
          </li>
        </ul>
      </section>

      {notice ? <Toast onClose={() => setNotice(null)}>{notice}</Toast> : null}
    </div>
  );
}
