/**
 * Pré-rendu des pages publiques (exécuté par Node au build, et par Vite en
 * développement). Chaque page est rendue en HTML statique ; les îlots
 * interactifs sont rendus dans leur propre racine React, à l'identique de
 * leur hydratation dans le navigateur (src/entries/islands.tsx).
 */
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { beginIslandCollection, endIslandCollection, type IslandSlot } from '../islands/Island';
import { ISLANDS } from '../islands/registry';
import { ContactPage } from '../pages/Contact';
import { LandingPage } from '../pages/Landing';
import { ListeAttentePage } from '../pages/ListeAttente';
import { NotFoundPage } from '../pages/NotFound';
import { OppositionPage } from '../pages/Opposition';
import { GuidePage } from '../pages/Guide';
import { TarifsPage } from '../pages/Tarifs';
import { FAQ_BILLING, FAQ_GENERAL, type FaqItem } from '../site/faq';
import { GUIDES } from '../site/guides';
import { htmlToText, jsonLd, jsonLdTag } from '../site/seo';
import { CguPage } from '../pages/legal/Cgu';
import { CgvPage } from '../pages/legal/Cgv';
import { ConfidentialitePage } from '../pages/legal/Confidentialite';
import { MentionsLegalesPage } from '../pages/legal/MentionsLegales';
import { RemboursementPage } from '../pages/legal/Remboursement';

const PAGES: Record<string, () => ReactElement> = {
  landing: LandingPage,
  tarifs: TarifsPage,
  'liste-attente': ListeAttentePage,
  contact: ContactPage,
  'mentions-legales': MentionsLegalesPage,
  cgu: CguPage,
  cgv: CgvPage,
  confidentialite: ConfidentialitePage,
  remboursement: RemboursementPage,
  opposition: OppositionPage,
  'not-found': NotFoundPage,
  ...Object.fromEntries(GUIDES.map((g) => [g.id, () => <GuidePage guide={g} />])),
};

export const PAGE_IDS = Object.keys(PAGES);

const escapeAttr = (s: string): string =>
  s.replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

function renderIsland(slot: IslandSlot): string {
  const component = ISLANDS[slot.name] as (props: object) => ReactElement | null;
  const inner = renderToString(createElement(component, slot.props));
  const cls = slot.className ? ` class="${escapeAttr(slot.className)}"` : '';
  return `<${slot.as} data-island="${slot.name}" data-props="${escapeAttr(JSON.stringify(slot.props))}"${cls}>${inner}</${slot.as}>`;
}

export function renderPage(id: string): string {
  const Page = PAGES[id];
  if (!Page) throw new Error(`Page inconnue : ${id}`);
  beginIslandCollection();
  let html: string;
  let slots: IslandSlot[];
  try {
    html = renderToString(createElement(Page));
  } finally {
    slots = endIslandCollection();
  }
  return html.replace(/<(div|span) data-island-slot="(\d+)"><\/\1>/g, (_match, _tag: string, index: string) => {
    const slot = slots[Number(index)];
    if (!slot) throw new Error(`Îlot introuvable : ${index}`);
    return renderIsland(slot);
  });
}

/** Questions affichées sur chaque page (pour la FAQ en données structurées). */
function pageFaq(id: string): FaqItem[] {
  if (id === 'landing') return FAQ_GENERAL;
  if (id === 'tarifs') return FAQ_BILLING;
  return GUIDES.find((g) => g.id === id)?.faq ?? [];
}

/** Données structurées (JSON-LD) d'une page publique, à insérer dans le <head>. */
export function renderJsonLd(id: string, path: string, site: string): string {
  const faq = pageFaq(id).map((i) => ({ q: i.q, a: htmlToText(renderToStaticMarkup(createElement('div', null, i.a))) }));
  return jsonLdTag(jsonLd(id, path, site, faq));
}
