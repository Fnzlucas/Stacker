/**
 * Garde-fous éditoriaux (faits produit et verdict du Lead §7) vérifiés sur le
 * HTML réellement pré-rendu de chaque page.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_IDS, renderPage } from '../ssr/render';
import pages from './pages.json';

const html = Object.fromEntries(PAGE_IDS.map((id) => [id, renderPage(id)])) as Record<string, string>;

const text = (h: string): string =>
  h
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;|\u00a0|\u202f/g, ' ')
    .replace(/\s+/g, ' ');

const MARKETING = ['landing', 'tarifs', 'liste-attente', 'contact', 'not-found'];

describe('pages pré-rendues', () => {
  it('chaque page de pages.json est rendue, avec un seul h1', () => {
    expect(PAGE_IDS.sort()).toEqual(pages.map((p) => p.id).sort());
    for (const id of PAGE_IDS) expect(html[id]?.match(/<h1[\s>]/g)?.length, id).toBe(1);
  });

  it('aucun attribut style (CSP stricte) ni script inline', () => {
    for (const id of PAGE_IDS) {
      expect(html[id], id).not.toMatch(/\sstyle="/);
      expect(html[id], id).not.toMatch(/<script/);
    }
  });

  it('aucun mot interdit : versé immédiatement, aussitôt, garanti, instantané', () => {
    for (const id of PAGE_IDS) {
      const t = text(html[id] ?? '');
      expect(t, id).not.toMatch(/vers[ée]e?s? (imm[ée]diatement|aussit[ôo]t)/i);
      expect(t, id).not.toMatch(/aussit[ôo]t/i);
      expect(t, id).not.toMatch(/garanti/i);
      expect(t, id).not.toMatch(/instantan/i);
      expect(t, id).not.toMatch(/emoji|🚀|💰|🔥/u);
    }
  });

  it('aucun montant en euros hors abonnement, sauf exemple marqué « Exemple illustratif »', () => {
    for (const id of PAGE_IDS) {
      const t = text(html[id] ?? '');
      for (const m of t.matchAll(/(\d[\d ]*(?:,\d+)?) ?€/g)) {
        if (m[1] === '6,99') continue;
        const before = t.slice(Math.max(0, m.index - 300), m.index);
        expect(before, `${id} : ${m[0]}`).toContain('Exemple illustratif');
      }
    }
  });

  it('pas de faux compteur : aucun nombre d’inscrits dans le HTML statique', () => {
    for (const id of PAGE_IDS) expect(text(html[id] ?? ''), id).not.toMatch(/\d+ (personnes? inscrites?|inscrits sur)/);
  });
});

describe('faits produit', () => {
  const landing = text(html['landing'] ?? '');

  it('paliers 15 / 18 / 22 / 25 % et commission récurrente', () => {
    for (const rate of ['15 %', '18 %', '22 %', '25 %']) expect(landing).toContain(rate);
    expect(landing).toContain('chaque mois tant que ton client reste abonné');
  });

  it('apporteur sans représentation : le stacker ne « conclut » ni ne « close » jamais la vente', () => {
    for (const id of PAGE_IDS) {
      const t = text(html[id] ?? '');
      expect(t, id).not.toMatch(/\btu (conclus|closes?)\b|tu as conclu|ventes que tu conclus/i);
    }
  });

  it('« Comment ça marche » en exactement 3 étapes, dans l’ordre', () => {
    const section = /<section[^>]*id="comment"[\s\S]*?<\/section>/.exec(html['landing'] ?? '')?.[0] ?? '';
    const steps = [...section.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => text(m[1] ?? '').replace(/Étape \d : /, '').trim());
    expect(steps).toHaveLength(3);
    expect(steps[0]).toContain('L’app trouve les entreprises');
    expect(steps[1]).toContain('Tu appelles et tu convaincs');
    expect(steps[2]).toContain('Stacker réalise, tu touches ta commission');
  });

  it('abonnement 6,99 € et son contenu, offre des 100 premiers, tarif futur non chiffré', () => {
    for (const id of ['landing', 'tarifs']) {
      const t = text(html[id] ?? '');
      expect(t, id).toContain('6,99 €');
      expect(t, id).toContain('Logiciel de prospection intégré');
      expect(t, id).toContain('Scripts et aide pour les appels');
      expect(t, id).toContain('Formation complète');
      expect(t, id).toContain('0 % prélevé sur ton chiffre d’affaires');
      expect(t, id).toContain('Le tarif évoluera après les 100 premiers');
      expect(t, id).toContain('Priorité aux inscrits');
    }
  });

  it('règle de disponibilité des commissions : signature, encaissement + 14 j / 30 j, hebdomadaire', () => {
    const t = text(html['tarifs'] ?? '');
    expect(t).toContain('visible dès la signature');
    expect(t).toContain('14 jours après l’encaissement effectif');
    expect(t).toContain('30 jours pour un nouveau client');
    expect(t).toMatch(/une fois par semaine|hebdomadaire/);
  });

  it('lancement le 20 octobre 2026 annoncé sur la landing', () => {
    expect(landing).toContain('20 octobre 2026');
  });

  it('les pages marketing ne mentionnent jamais ce que paie l’entreprise cliente', () => {
    for (const id of MARKETING) expect(text(html[id] ?? ''), id).not.toMatch(/€ ?(HT|TTC)? ?(par|\/) ?mois pour (l’|le )?(entreprise|client)/i);
  });
});

describe('pages légales', () => {
  const legalDir = join(import.meta.dirname, '..', 'pages', 'legal');

  it('chaque fichier source commence par « À faire valider par un juriste »', () => {
    const files = readdirSync(legalDir).filter((f) => f.endsWith('.tsx'));
    expect(files.sort()).toEqual(['Cgu.tsx', 'Cgv.tsx', 'Confidentialite.tsx', 'MentionsLegales.tsx', 'Remboursement.tsx']);
    for (const f of files) expect(readFileSync(join(legalDir, f), 'utf8').startsWith('/*\n * À faire valider par un juriste'), f).toBe(true);
  });

  it('le commentaire juriste n’est pas visible sur le site', () => {
    for (const id of PAGE_IDS) expect(html[id], id).not.toMatch(/juriste/i);
  });

  it('éditeur, hébergeur et placeholders clairement marqués', () => {
    const t = text(html['mentions-legales'] ?? '');
    expect(t).toContain('Lucas Fernandez');
    expect(t).toContain('entrepreneur individuel');
    expect(t).toContain('Vercel Inc.');
    expect(t).toContain('{{À COMPLÉTER : SIRET}}');
    expect(t).toContain('{{À COMPLÉTER : adresse}}');
    expect(t).toContain('{{À COMPLÉTER : email de contact}}');
  });

  it('CGV : rétractation 14 jours, résiliation simple, offre des 100 premiers', () => {
    const t = text(html['cgv'] ?? '');
    expect(t).toContain('14 jours');
    expect(t).toContain('Résilier mon abonnement');
    expect(t).toContain('Offre de lancement des 100 premiers');
    expect(t).toContain('0 %');
  });
});
