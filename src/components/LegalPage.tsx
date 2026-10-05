import type { ReactElement, ReactNode } from 'react';
import { PRODUCT } from '../config/site';
import { PageShell } from './Layout';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

/**
 * Gabarit des pages légales. Chaque page (src/pages/legal/*.tsx) porte en
 * tête un commentaire « À faire valider par un juriste », absent du HTML
 * publié.
 */
export function LegalPage({
  title,
  intro,
  sections,
  version = PRODUCT.legalVersion,
}: {
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
  version?: string;
}): ReactElement {
  return (
    <PageShell current="legal">
      <article className="site-section hero-section" aria-labelledby="legal-title" data-legal-version={version}>
        <div className="site-container grid grid-cols-1 gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav className="hidden lg:block" aria-label="Sommaire">
            <div className="sticky top-24">
              <p className="eyebrow mb-3 px-3">Sommaire</p>
              <ol className="toc">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`}>{s.title}</a>
                  </li>
                ))}
              </ol>
            </div>
          </nav>
          <div className="min-w-0 max-w-3xl">
            <span className="eyebrow">Informations légales</span>
            <h1 id="legal-title" className="display mt-4 text-[36px] lg:text-5xl">
              {title}
            </h1>
            <p className="text-small mt-4">
              Dernière mise à jour : {PRODUCT.legalUpdatedLabel}
            </p>
            <div className="prose-legal mt-8">
              <div className="lead">{intro}</div>
              {sections.map((s) => (
                <section key={s.id} aria-labelledby={s.id}>
                  <h2 id={s.id}>{s.title}</h2>
                  {s.body}
                </section>
              ))}
            </div>
          </div>
        </div>
      </article>
    </PageShell>
  );
}
