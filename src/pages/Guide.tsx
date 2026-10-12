import type { ReactElement } from 'react';
import { Icon } from '../components/Icon';
import { PageShell } from '../components/Layout';
import { Faq, JoinCta } from '../components/Sections';
import { GUIDES, type Guide } from '../site/guides';

const longDate = (iso: string): string => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

/** Guide public : réponse immédiate, sommaire, sections, FAQ, autres guides. */
export function GuidePage({ guide }: { guide: Guide }): ReactElement {
  const others = GUIDES.filter((g) => g.id !== guide.id);
  return (
    <PageShell current="none">
      <article className="site-section hero-section" aria-labelledby="guide-title">
        <div className="site-container grid grid-cols-1 gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav className="hidden lg:block" aria-label="Sommaire">
            <div className="sticky top-24">
              <p className="eyebrow mb-3 px-3">Sommaire</p>
              <ol className="toc">
                {guide.sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`}>{s.title}</a>
                  </li>
                ))}
                <li>
                  <a href="#questions">Questions fréquentes</a>
                </li>
              </ol>
            </div>
          </nav>
          <div className="min-w-0 max-w-3xl">
            <nav aria-label="Fil d’Ariane" className="text-small">
              <a className="link" href="/">
                Accueil
              </a>{' '}
              / <span>Guides</span>
            </nav>
            <h1 id="guide-title" className="display mt-4 text-[34px] lg:text-5xl">
              {guide.h1}
            </h1>
            <p className="text-small mt-4">
              Mis à jour le <time dateTime={guide.updated}>{longDate(guide.updated)}</time> · {guide.readingMinutes} min de lecture · par l’équipe Stacker
            </p>
            <div className="card card-flat guide-answer mt-8">
              <Icon name="info" />
              <p>
                <strong>En bref.</strong> {guide.answer}
              </p>
            </div>
            <div className="prose-legal mt-4">
              {guide.sections.map((s) => (
                <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`}>
                  <h2 id={`${s.id}-title`}>{s.title}</h2>
                  {s.body}
                </section>
              ))}
              <section id="questions" aria-labelledby="questions-title">
                <h2 id="questions-title">Questions fréquentes</h2>
                <div className="mt-4">
                  <Faq items={guide.faq} />
                </div>
              </section>
              {others.length ? (
                <section aria-labelledby="autres-guides">
                  <h2 id="autres-guides">À lire aussi</h2>
                  <ul>
                    {others.map((g) => (
                      <li key={g.id}>
                        <a href={g.path}>{g.h1}</a>
                      </li>
                    ))}
                    <li>
                      <a href="/tarifs">Tarifs et commissions de Stacker</a>
                    </li>
                  </ul>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      </article>
      <JoinCta id="guide-cta" />
    </PageShell>
  );
}
