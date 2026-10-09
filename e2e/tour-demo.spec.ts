/**
 * Visite de l'app (vidéo + captures), à la demande : DEMO=1.
 *   DEMO=1 pnpm exec playwright test e2e/tour-demo.spec.ts --project=mobile-390
 * Données de DÉMONSTRATION dans le faux Supabase des tests (jamais en production).
 */
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

test.skip(!process.env['DEMO'], 'visite à la demande : DEMO=1');

const SHOTS = 'qa/tour';

test('visite de l’app', async ({ browser, supabase }) => {
  test.setTimeout(240_000);
  mkdirSync(SHOTS, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: 'http://localhost:4174',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    recordVideo: { dir: 'qa/demo/.raw/tour', size: { width: 390, height: 844 } },
  });
  const page = await ctx.newPage();
  await page.route('https://e2e-stacker.supabase.co/**', async (route) => {
    if (!(await supabase.fake.handle(route))) await route.fulfill({ status: 404, json: {} });
  });
  let n = 0;
  const shot = async (name: string, p: Page = page) => {
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png` });
  };
  const pause = (ms = 1200) => page.waitForTimeout(ms);
  const nav = () => page.getByRole('navigation', { name: 'Navigation de l’application' });

  // Données de démonstration : boîte connectée, campagne en cours, quelques prospects suivis.
  const user = supabase.fake.seedUser({ email: 'ines@exemple.fr', password: 'Plombier-Avignon-2026', firstName: 'Inès', onboarded: true, profile: { last_name: 'Martin', phone: '+33611223344', department: '30', city: 'Nîmes' } });
  const fp = supabase.fake.prospects;
  fp.rules.set(user.id, '2026-10-09');
  fp.mailboxes.set(user.id, { provider: 'gmail', email: 'ines.martin@gmail.com', status: 'active' });
  fp.campaigns.set(user.id, { id: '00000000-0000-4000-8000-0000000000aa', department: '30', preset: 'batiment', daily_target: 200, template_key: 'decouverte', status: 'active', created_at: new Date().toISOString(), sent_today: 13, sent_total: 128 });
  const statuses = ['a_repondu', 'rdv', 'contacte', 'contacte', 'a_contacter'];
  const sirets = [...fp.companies.keys()].slice(0, 5);
  sirets.forEach((siret, i) => {
    const id = `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`;
    fp.claims.push({
      id,
      stacker: user.id,
      siret,
      status: statuses[i] ?? 'contacte',
      claimed_at: new Date(Date.now() - (5 - i) * 86_400_000).toISOString(),
      expires_at: new Date(Date.now() + (i === 4 ? 1 : 18) * 86_400_000).toISOString(),
      extended: false,
      next_action_at: i === 0 ? new Date().toISOString() : i === 1 ? new Date(Date.now() + 2 * 86_400_000).toISOString() : null,
      contact_phone: '+33490123456',
      contact_email: `contact@entreprise${String(i + 1)}.fr`,
      contact_email_kind: 'generique',
      contact_source: `https://entreprise${String(i + 1)}.fr/contact`,
      released_at: null,
      release_reason: null,
    });
    fp.events.push({ claim_id: id, stacker: user.id, kind: 'reserve', payload: {}, created_at: new Date(Date.now() - 5 * 86_400_000).toISOString() });
    fp.events.push({ claim_id: id, stacker: user.id, kind: 'email_envoye', payload: {}, created_at: new Date(Date.now() - 4 * 86_400_000).toISOString() });
    if (i === 0) fp.events.push({ claim_id: id, stacker: user.id, kind: 'statut', payload: { from: 'contacte', to: 'a_repondu' }, created_at: new Date(Date.now() - 86_400_000).toISOString() });
  });
  fp.notes.push({ id: '00000000-0000-4000-8000-0000000002aa', claim_id: '00000000-0000-4000-8000-000000000100', stacker: user.id, body: 'A répondu à l’email : veut un site + gestion des avis. Rappeler ce matin.', created_at: new Date().toISOString() });

  // 1. Ouverture : splash puis accueil avant connexion.
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: 'Stack tes clients.' })).toBeVisible();
  await pause(2200);
  await shot('accueil-avant-connexion');
  await page.getByRole('link', { name: 'J’ai déjà un compte' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await shot('connexion');
  await page.getByLabel('Adresse email').fill('ines@exemple.fr');
  await page.getByLabel('Mot de passe', { exact: true }).fill('Plombier-Avignon-2026');
  await pause(500);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  // 2. Accueil.
  await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();
  await pause();
  await shot('accueil');
  await page.mouse.wheel(0, 600);
  await pause(900);

  // 3. Prospects : campagne en cours.
  await nav().getByRole('link', { name: 'Prospects' }).click();
  await expect(page.getByRole('region', { name: /Artisans du bâtiment/ })).toBeVisible();
  await pause();
  await shot('campagne-boite');
  await page.getByRole('region', { name: /Artisans du bâtiment/ }).scrollIntoViewIfNeeded();
  await pause(1500);
  await shot('campagne-en-cours');

  // 4. Mes prospects.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: /Mes prospects/ }).click();
  await expect(page.locator('.pros-list')).toBeVisible();
  await pause();
  await shot('mes-prospects');
  await page.getByRole('button', { name: /À relancer/ }).click();
  await pause(900);
  await page.getByRole('button', { name: /Tous/ }).click();
  await pause(600);

  // 5. Fiche d'un prospect qui a répondu.
  await page.locator('.pros-list a').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await pause();
  await shot('fiche-haut');
  await page.mouse.wheel(0, 700);
  await pause(1000);
  await shot('fiche-appel-email');
  await page.getByRole('button', { name: 'Préparer l’email' }).click();
  await expect(page.getByLabel('Aperçu de l’email')).toBeVisible();
  await page.getByLabel('Aperçu de l’email').scrollIntoViewIfNeeded();
  await pause(1500);
  await shot('fiche-email-pret');
  await page.mouse.wheel(0, 900);
  await pause(1000);
  await shot('fiche-statut-notes');

  // 6. Recherche manuelle.
  await nav().getByRole('link', { name: 'Prospects' }).click();
  await page.getByRole('button', { name: 'Recherche', exact: true }).click();
  await page.getByRole('button', { name: 'Artisans du bâtiment' }).click();
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page.locator('.pros-results')).toBeVisible();
  await page.locator('.pros-results').scrollIntoViewIfNeeded();
  await pause(1500);
  await shot('recherche');

  // 7. Deals, Gains, Profil.
  for (const [tab, name] of [
    ['Deals', 'deals'],
    ['Gains', 'gains'],
    ['Profil', 'profil'],
  ] as const) {
    await nav().getByRole('link', { name: tab }).click();
    await expect(page.getByRole('heading', { level: 1, name: tab })).toBeVisible();
    await pause();
    await shot(name);
  }
  await ctx.close();
});
