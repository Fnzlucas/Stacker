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
import { needsSubscription } from '../lib/billing';
import { useBilling } from '../lib/billingQueries';
import { formatEuros } from '../lib/deals';
import { isNativeApp } from '../lib/platform';

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
  const locked = r ? !r.academy : false;
  const billing = useBilling();
  const pro = !needsSubscription(billing.data);

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

      {locked ? <AcademyLock qualification={Boolean(r?.qualification)} /> : null}

      {ready ? (
        <Link className="card academy-ready" to={pro ? PATHS.prospects : PATHS.dealNew}>
          <span className="academy-ready-icon" aria-hidden="true">
            <Icon name="target" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="list-title">Tu es prêt : passe aux vrais appels</span>
            <span className="list-sub">
              {pro
                ? 'Trouve tes premières entreprises et appelle-les. Continue à t’entraîner entre deux appels.'
                : 'Choisis ton offre et fais signer ton premier client. Continue à t’entraîner entre deux appels.'}
            </span>
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

      <p className="text-small academy-note">Entraîne-toi avant chaque vrai appel : c’est comme ça qu’on décroche ses premiers oui.</p>
    </div>
  );
}

/** Academy non incluse dans la formule du stacker. */
export function AcademyLock({ qualification }: { qualification: boolean }): ReactElement {
  const billing = useBilling();
  const native = isNativeApp();
  const p = billing.data?.prices;
  return (
    <section className="card academy-lock" role="status" aria-labelledby="academy-lock-title">
      <span className="academy-item-icon" aria-hidden="true">
        <Icon name="lock" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="academy-lock-title" className="list-title">
          {native ? 'L’Academy n’est pas active sur ce compte' : 'L’Academy n’est pas dans ta formule'}
        </h2>
        <p className="list-sub">
          {qualification
            ? 'Ton appel d’habilitation reste ouvert : réussis-le avant ta première signature. '
            : ''}
          {native
            ? 'Entraînement libre et formation ne sont pas disponibles pour l’instant.'
            : `Entraînement libre et formation sont inclus dans Academy${p ? ` (${formatEuros(p.academy, { always: true })} / mois)` : ''} et Academy + Pro${p ? ` (${formatEuros(p.duo, { always: true })} / mois)` : ''}.`}
        </p>
        {native ? null : (
          <Link className="btn btn-accent btn-sm mt-3" to={PATHS.billing}>
            Voir les formules
          </Link>
        )}
      </div>
    </section>
  );
}
