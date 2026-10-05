import type { ReactElement, ReactNode } from 'react';
import { ENTITY, PRODUCT } from '../config/site';
import { Fill } from './Fill';
import { Icon } from './Icon';
import { LogoLockup } from './Logo';

export type NavKey = 'home' | 'tarifs' | 'liste' | 'contact' | 'legal' | 'none';

const NAV = [
  { href: '/#comment', label: 'Comment ça marche', key: 'none' },
  { href: '/#paliers', label: 'Commissions', key: 'none' },
  { href: '/tarifs', label: 'Tarifs', key: 'tarifs' },
  { href: '/#faq', label: 'FAQ', key: 'none' },
] as const;

export function SiteHeader({ current, ctaHref = '/liste-attente' }: { current: NavKey; ctaHref?: string }): ReactElement {
  return (
    <header className="appbar site-header">
      <div className="site-header-inner">
        <a className="logo-link" href="/" aria-label="Stacker, accueil">
          <LogoLockup size={32} />
        </a>
        <nav className="site-nav" aria-label="Navigation principale">
          {NAV.map((item) => (
            <a key={item.href} className="link" href={item.href} aria-current={item.key === current ? 'page' : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
        <a className="btn btn-primary btn-sm" href={ctaHref}>
          Rejoindre la liste
        </a>
      </div>
    </header>
  );
}

export function SiteFooter(): ReactElement {
  return (
    <footer className="site-footer">
      <div className="site-container">
        <div className="site-footer-grid">
          <div>
            <LogoLockup size={28} />
            <p className="text-small mt-4 max-w-sm">
              Stacker propose aux entreprises des services qu’il réalise lui-même. Des apporteurs d’affaires indépendants, les stackers, lui
              présentent des clients et touchent une commission. Ouverture le {PRODUCT.launchDateLabel}.
            </p>
            <p className="text-small mt-3 max-w-sm">Service édité par {ENTITY.legalName}, entrepreneur individuel.</p>
          </div>
          <nav aria-labelledby="footer-produit">
            <h2 id="footer-produit">Produit</h2>
            <ul>
              <li><a href="/#comment">Comment ça marche</a></li>
              <li><a href="/#paliers">Commissions</a></li>
              <li><a href="/tarifs">Tarifs</a></li>
              <li><a href="/liste-attente">Liste d’attente</a></li>
              <li><a href="/#faq">Questions fréquentes</a></li>
              <li><a href="/contact">Contact</a></li>
            </ul>
          </nav>
          <nav aria-labelledby="footer-legal">
            <h2 id="footer-legal">Informations légales</h2>
            <ul>
              <li><a href="/mentions-legales">Mentions légales</a></li>
              <li><a href="/cgu">Conditions d’utilisation</a></li>
              <li><a href="/cgv">Conditions de vente</a></li>
              <li><a href="/confidentialite">Confidentialité</a></li>
              <li><a href="/remboursement">Remboursement</a></li>
            </ul>
          </nav>
        </div>
        <p className="text-small mt-10 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Icon name="mail" size={16} />
          <span>Contact :</span>
          <Fill value={ENTITY.email} />
        </p>
        <p className="text-small mt-2">© 2026 Stacker. Les visuels marqués « Exemple illustratif » ne constituent pas une promesse de revenu.</p>
      </div>
    </footer>
  );
}

export function PageShell({
  current,
  children,
  ctaHref,
}: {
  current: NavKey;
  children: ReactNode;
  ctaHref?: string;
}): ReactElement {
  return (
    <>
      <a className="skip-link" href="#contenu">
        Aller au contenu
      </a>
      <SiteHeader current={current} {...(ctaHref ? { ctaHref } : {})} />
      <main id="contenu" className="site-main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
