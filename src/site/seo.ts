/**
 * Données structurées (schema.org, JSON-LD) des pages publiques : ce que
 * Google affiche en résultats enrichis et ce que les assistants IA lisent
 * pour comprendre qui est Stacker, ce qu'il propose et à quel prix.
 * Uniquement des faits déjà affichés sur la page (pas de note, pas d'avis
 * tant qu'il n'y en a pas de vrais).
 */
import { ENTITY, PRODUCT } from '../config/site';
import { GUIDES } from './guides';

export interface FaqText {
  q: string;
  a: string;
}

type Json = Record<string, unknown>;

const PRICE = '6.99';

export function organization(site: string): Json {
  return {
    '@type': 'Organization',
    '@id': `${site}/#organisation`,
    name: 'Stacker',
    url: `${site}/`,
    logo: { '@type': 'ImageObject', url: `${site}/icons/icon-512.png`, width: 512, height: 512 },
    email: ENTITY.email,
    address: { '@type': 'PostalAddress', streetAddress: '4 impasse Jean Roussière', postalCode: '30400', addressLocality: 'Villeneuve-lès-Avignon', addressCountry: 'FR' },
    founder: { '@type': 'Person', name: ENTITY.legalName },
    description:
      'Stacker est une application française d’apport d’affaires : des indépendants, les stackers, présentent à des entreprises des services réalisés par Stacker (site web, avis Google, visibilité locale, réseaux sociaux) et touchent de 15 à 25 % de commission sur chaque paiement mensuel du client.',
    areaServed: { '@type': 'Country', name: 'France' },
  };
}

export function website(site: string): Json {
  return { '@type': 'WebSite', '@id': `${site}/#site`, name: 'Stacker', url: `${site}/`, inLanguage: 'fr-FR', publisher: { '@id': `${site}/#organisation` } };
}

export function app(site: string): Json {
  return {
    '@type': 'SoftwareApplication',
    '@id': `${site}/#app`,
    name: 'Stacker',
    url: `${site}/`,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, Android, iOS',
    inLanguage: 'fr-FR',
    description:
      'Application pour apporteurs d’affaires indépendants : recherche d’entreprises à contacter, emails de prospection, scripts d’appel, formation et signature des contrats clients sur le téléphone. Commission de 15 à 25 % sur chaque paiement mensuel du client, tant qu’il reste abonné.',
    offers: {
      '@type': 'Offer',
      name: 'Abonnement stacker',
      price: PRICE,
      priceCurrency: 'EUR',
      priceSpecification: { '@type': 'UnitPriceSpecification', price: PRICE, priceCurrency: 'EUR', unitText: 'mois', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' } },
      availabilityStarts: PRODUCT.launchDateISO,
      url: `${site}/tarifs`,
    },
    publisher: { '@id': `${site}/#organisation` },
  };
}

export function faqPage(url: string, items: FaqText[]): Json {
  return {
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    mainEntity: items.map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })),
  };
}

/** Graphe JSON-LD d'une page publique. `faq` : questions de la page, en texte brut. */
export function jsonLd(pageId: string, path: string, site: string, faq: FaqText[]): Json {
  const url = path === '/' ? `${site}/` : `${site}${path}`;
  const graph: Json[] = [organization(site), website(site)];
  const guide = GUIDES.find((g) => g.id === pageId);
  if (pageId === 'landing' || pageId === 'tarifs') graph.push(app(site));
  if (guide) {
    graph.push({
      '@type': 'Article',
      '@id': `${url}#article`,
      headline: guide.h1,
      description: guide.answer,
      inLanguage: 'fr-FR',
      datePublished: guide.published,
      dateModified: guide.updated,
      author: { '@id': `${site}/#organisation` },
      publisher: { '@id': `${site}/#organisation` },
      mainEntityOfPage: url,
      image: `${site}/og.png`,
      about: { '@id': `${site}/#app` },
    });
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${site}/` },
        { '@type': 'ListItem', position: 2, name: guide.h1, item: url },
      ],
    });
  }
  if (faq.length) graph.push(faqPage(url, faq));
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** Balise prête à insérer dans le <head> ; « < » échappé pour ne jamais fermer la balise. */
export function jsonLdTag(data: Json): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/** Texte brut d'un fragment HTML rendu (réponses de FAQ). */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
