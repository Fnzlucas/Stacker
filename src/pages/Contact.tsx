import type { ReactElement } from 'react';
import { Fill } from '../components/Fill';
import { Icon } from '../components/Icon';
import { PageShell } from '../components/Layout';
import { ENTITY, isTodo } from '../config/site';
import { Island } from '../islands/Island';

export function ContactPage(): ReactElement {
  return (
    <PageShell current="contact">
      <section className="site-section hero-section" aria-labelledby="contact-title">
        <div className="site-container grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <span className="eyebrow">Contact</span>
            <h1 id="contact-title" className="display hero-title mt-4">
              Une question ? <span className="serif-accent">Écris-nous</span>.
            </h1>
            <p className="lead mt-5 max-w-xl">Une question sur Stacker, la liste d’attente, ton abonnement ou tes données personnelles : écris-nous, on te répond par email.</p>
            <ul className="list mt-8" aria-label="Coordonnées">
              <li>
                <div className="list-row">
                  <span className="avatar avatar-violet">
                    <Icon name="mail" />
                  </span>
                  <span className="list-main">
                    <span className="list-title">Email</span>
                    <span className="list-sub whitespace-normal">
                      <Fill value={ENTITY.email} {...(isTodo(ENTITY.email) ? {} : { href: `mailto:${ENTITY.email}` })} />
                    </span>
                  </span>
                </div>
              </li>
              <li>
                <div className="list-row">
                  <span className="avatar avatar-green">
                    <Icon name="phone" />
                  </span>
                  <span className="list-main">
                    <span className="list-title">Téléphone</span>
                    <span className="list-sub whitespace-normal">
                      <Fill value={ENTITY.phone} />
                    </span>
                  </span>
                </div>
              </li>
              <li>
                <div className="list-row">
                  <span className="avatar avatar-orange">
                    <Icon name="map-pin" />
                  </span>
                  <span className="list-main">
                    <span className="list-title">Adresse postale</span>
                    <span className="list-sub whitespace-normal">
                      <span>
                        {ENTITY.legalName}, <Fill value={ENTITY.address} />
                      </span>
                    </span>
                  </span>
                </div>
              </li>
              <li>
                <a className="list-row" href="/confidentialite#droits">
                  <span className="avatar">
                    <Icon name="shield" />
                  </span>
                  <span className="list-main">
                    <span className="list-title">Données personnelles</span>
                    <span className="list-sub whitespace-normal">Accès, rectification, suppression : comment exercer tes droits</span>
                  </span>
                  <Icon name="chevron-right" className="list-chevron" size={18} />
                </a>
              </li>
            </ul>
          </div>
          <Island name="contact-form" props={{}} />
        </div>
      </section>
    </PageShell>
  );
}
