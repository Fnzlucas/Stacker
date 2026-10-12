import type { ReactElement } from 'react';
import { useSearchParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { FormAlert } from '../components/Form';
import { AppBar, usePageTitle } from '../components/Layouts';
import { ProgressBar } from '../components/Ui';
import { FORMATION, formationProgress, type FormationModule, type FormationSection } from '../lib/formation';
import { useFormation, useSetModuleDone } from '../lib/formationQueries';

/** Formation : 8 modules courts, scripts d'appel et réponses aux objections. */
export function FormationPage(): ReactElement {
  usePageTitle('Formation');
  const [params, setParams] = useSearchParams();
  const open = params.get('module');
  const formation = useFormation();
  const done = formation.data ?? [];
  const progress = formationProgress(done);

  return (
    <div className="app-container formation">
      <AppBar title="Formation" />
      <section className="card card-hero formation-head" aria-labelledby="formation-progress">
        <h2 id="formation-progress" className="h3">
          {progress.done === progress.total ? 'Formation terminée, bravo !' : `${String(progress.done)} module${progress.done > 1 ? 's' : ''} sur ${String(progress.total)}`}
        </h2>
        <ProgressBar percent={progress.percent} label="Progression de la formation" tone="green" />
        <p className="text-2 text-sm">
          {progress.next ? `À suivre : ${progress.next.title} (${String(progress.next.minutes)} min).` : 'Garde les scripts sous la main : ils restent ici.'}
        </p>
      </section>
      {formation.isError ? <FormAlert>La progression n’a pas pu être chargée. Tu peux quand même lire les modules.</FormAlert> : null}
      <ol className="formation-list">
        {FORMATION.map((m, i) => (
          <Module
            key={m.id}
            m={m}
            index={i + 1}
            done={done.includes(m.id)}
            open={open === m.id}
            onToggle={(isOpen) => {
              if (isOpen && open !== m.id) setParams({ module: m.id }, { replace: true });
              if (!isOpen && open === m.id) setParams({}, { replace: true });
            }}
          />
        ))}
      </ol>
    </div>
  );
}

function Module({ m, index, done, open, onToggle }: { m: FormationModule; index: number; done: boolean; open: boolean; onToggle: (open: boolean) => void }): ReactElement {
  const set = useSetModuleDone();
  return (
    <li>
      <details className={`card formation-module${done ? ' is-done' : ''}`} id={`module-${m.id}`} open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
        <summary>
          <span className={`avatar ${done ? 'avatar-green' : 'avatar-violet'}`} aria-hidden="true">
            <Icon name={done ? 'check' : m.icon} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="formation-index">Module {index}</span>
            <span className="list-title">{m.title}</span>
            <span className="formation-summary">
              {m.summary} · {m.minutes} min{done ? ' · terminé' : ''}
            </span>
          </span>
          <Icon name="chevron-down" className="formation-chevron" />
        </summary>
        <div className="formation-body">
          {m.sections.map((s) => (
            <Section key={s.title} s={s} />
          ))}
          <button
            type="button"
            className={`btn ${done ? 'btn-secondary' : 'btn-accent'} btn-block${set.isPending ? ' is-loading' : ''}`}
            disabled={set.isPending}
            onClick={() => set.mutate({ id: m.id, done: !done })}
          >
            <Icon name="check" />
            {done ? 'Marquer comme non terminé' : 'J’ai terminé ce module'}
          </button>
          {set.isError ? <FormAlert>Impossible d’enregistrer pour l’instant. Réessaie dans un instant.</FormAlert> : null}
        </div>
      </details>
    </li>
  );
}

function Section({ s }: { s: FormationSection }): ReactElement {
  return (
    <section className="formation-section">
      <h3 className="formation-section-title">{s.title}</h3>
      {s.text?.map((t) => (
        <p key={t}>{t}</p>
      ))}
      {s.bullets ? (
        <ul>
          {s.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
      {s.script ? (
        <dl className="formation-script">
          {s.script.map((l, i) => (
            <div key={`${String(i)}-${l.who}`} className={`is-${l.who}`}>
              <dt>{l.who === 'toi' ? 'Toi' : 'Prospect'}</dt>
              <dd>{l.line}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {s.answers ? (
        <dl className="formation-answers">
          {s.answers.map((a) => (
            <div key={a.objection}>
              <dt>{a.objection}</dt>
              <dd>{a.answer}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
