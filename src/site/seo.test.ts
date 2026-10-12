import { describe, expect, it } from 'vitest';
import { GUIDES } from './guides';
import { htmlToText, jsonLd, jsonLdTag } from './seo';

const SITE = 'https://stacker.example';
const types = (d: ReturnType<typeof jsonLd>) => (d['@graph'] as { '@type': string }[]).map((g) => g['@type']);

describe('données structurées', () => {
  it('accueil : entreprise, site, application avec son prix, FAQ', () => {
    const d = jsonLd('landing', '/', SITE, [{ q: 'Q ?', a: 'R.' }]);
    expect(d['@context']).toBe('https://schema.org');
    expect(types(d)).toEqual(['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage']);
    const app = (d['@graph'] as Record<string, unknown>[])[2] as { offers: { price: string; priceCurrency: string } };
    expect(app.offers).toMatchObject({ price: '6.99', priceCurrency: 'EUR' });
  });
  it('guides : article daté, fil d’Ariane ; pages sans FAQ : pas de FAQPage', () => {
    for (const g of GUIDES) {
      const d = jsonLd(g.id, g.path, SITE, []);
      expect(types(d)).toEqual(['Organization', 'WebSite', 'Article', 'BreadcrumbList']);
      expect(JSON.stringify(d)).toContain(`${SITE}${g.path}`);
    }
    expect(types(jsonLd('contact', '/contact', SITE, []))).toEqual(['Organization', 'WebSite']);
  });
  it('balise sûre et texte brut', () => {
    expect(jsonLdTag({ a: '</script><b>' })).toBe('<script type="application/ld+json">{"a":"\\u003c/script>\\u003cb>"}</script>');
    expect(htmlToText('<div><p>Prix&nbsp;: 6,99 &amp; plus</p>\n<p>l&#x27;app</p></div>')).toBe('Prix : 6,99 & plus l\'app');
  });
});

describe('guides', () => {
  it('réponse immédiate, aucune promesse de revenu', () => {
    for (const g of GUIDES) {
      expect(g.answer.length, g.id).toBeGreaterThan(120);
      expect(g.faq.length, g.id).toBeGreaterThanOrEqual(3);
      const text = JSON.stringify(g);
      expect(text, g.id).not.toMatch(/garanti|devenir riche/i);
    }
    expect(JSON.stringify(GUIDES)).toContain('aucun montant de gain n’est promis');
  });
});
