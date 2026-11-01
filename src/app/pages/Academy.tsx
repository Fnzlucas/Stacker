/**
 * Stacker Academy : l'endroit où l'on apprend à convaincre, gratuitement et
 * en continu. Appels d'entraînement face à l'IA, formation, progression. Quand
 * le stacker est prêt (un appel réussi), on l'invite à passer au vrai.
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/Icon';
import { Ransom } from '../../components/Ransom';
import { usePageTitle } from '../components/Layouts';
import { ProgressBar } from '../components/Ui';
import { formationProgress } from '../lib/formation';
import { useFormation } from '../lib/formationQueries';
import { useRoleplay } from '../lib/roleplayQueries';
import { PATHS } from '../paths';

/** Statistiques de l'Academy (pures, testées). */
export function academyStats(history: readonly { score: number | null; passed: boolean }[]): { calls: number; best: number | null; passedCount: number } {
  const scores = history.map((h) => h.score).filter((s): s is number => s !== null);
  return { calls: history.length, best: scores.length ? Math.max(...scores) : null, passedCount: history.filter((h) => h.passed).length };
}

export function AcademyPage(): ReactElement {
  usePageTitle('Academy');
  const roleplay = useRoleplay();
  const formation = useFormation();
  const r = roleplay.data;
  const f = formationProgress(formation.data ?? []);
  const stats = academyStats(r?.history ?? []);
  const left = r ? Math.max(0, r.today.limit - r.today.used) : null;
  const ready = Boolean(r?.passed);

  return (
    <div className="app-container academy">
      <section className="card card-dark academy-hero" aria-labelledby="academy-title">
        <p className="eyebrow academy-eyebrow">Stacker Academy</p>
        <h1 id="academy-title" className="academy-title" tabIndex={-1}>
          <span className="sr-only">Stacker Academy : </span>
          <Ransom text="DÉCROCHE TES OUI" animated className="ransom-sm" />
        </h1>
        <p className="academy-lead">Entraîne-toi face à des commerçants joués par une IA, apprends les bons réflexes, puis passe aux vrais appels quand tu es prêt.</p>
        <dl className="academy-stats">
          <div>
            <dt>Appels</dt>
            <dd className="num">{stats.calls}</dd>
          </div>
          <div>
            <dt>Meilleure note</dt>
            <dd className="num">{stats.best === null ? '—' : `${String(stats.best)}/100`}</dd>
          </div>
          <div>
            <dt>Formation</dt>
            <dd className="num">
              {f.done}/{f.total}
            </dd>
          </div>
        </dl>
      </section>

      {ready ? (
        <Link className="card academy-ready" to={PATHS.prospects}>
          <span className="academy-ready-icon" aria-hidden="true">
            <Icon name="target" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="list-title">Tu es prêt : passe aux vrais appels</span>
            <span className="list-sub">Trouve tes premières entreprises et appelle-les. Continue à t’entraîner entre deux appels.</span>
          </span>
          <Icon name="chevron-right" />
        </Link>
      ) : null}

      <ul className="academy-list">
        <li>
          <Link className="card academy-item is-green" to={PATHS.training}>
            <span className="academy-item-icon" aria-hidden="true">
              <Icon name="mic" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="list-title">Appel d’entraînement</span>
              <span className="list-sub">
                Un commerçant décroche, objecte, peut raccrocher. Ta note sur 100 à la fin.
                {left !== null ? ` · ${String(left)} appel${left > 1 ? 's' : ''} aujourd’hui` : ''}
              </span>
            </span>
            <Icon name="chevron-right" />
          </Link>
        </li>
        <li>
          <Link className="card academy-item is-violet" to={PATHS.formation}>
            <span className="academy-item-icon" aria-hidden="true">
              <Icon name="graduation" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="list-title">Formation</span>
              <span className="list-sub">{f.next ? `Prochain module : ${f.next.title}` : 'Tous les modules sont faits. Révise quand tu veux.'}</span>
              <ProgressBar percent={f.percent} tone="violet" label="Formation suivie" />
            </span>
            <Icon name="chevron-right" />
          </Link>
        </li>
      </ul>

      <p className="text-small academy-note">L’Academy est gratuite et reste ouverte : entraîne-toi avant chaque vrai appel.</p>
    </div>
  );
}
