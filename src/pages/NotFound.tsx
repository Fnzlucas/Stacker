import type { ReactElement } from 'react';
import { Icon } from '../components/Icon';
import { PageShell } from '../components/Layout';
import { Ransom } from '../components/Ransom';

export function NotFoundPage(): ReactElement {
  return (
    <PageShell current="none">
      <section className="site-section" aria-labelledby="nf-title">
        <div className="site-container site-container-narrow text-center">
          <h1 id="nf-title">
            <span className="sr-only">Erreur 404 : page introuvable</span>
            <span aria-hidden="true">
              <Ransom text="404" className="ransom-lg" />
            </span>
          </h1>
          <p className="section-title mt-8">Cette page n’existe pas.</p>
          <p className="lead mx-auto mt-4 max-w-md">Elle a peut-être été déplacée, ou le lien est incomplet.</p>
          <div className="mt-8 flex flex-col justify-center gap-3 md:flex-row">
            <a className="btn btn-primary" href="/">
              <Icon name="home" />
              Retour à l’accueil
            </a>
            <a className="btn btn-secondary" href="/liste-attente">
              Rejoindre la liste d’attente
            </a>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
