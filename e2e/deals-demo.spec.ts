/**
 * Démo « faire signer un client » (vidéo + captures), à la demande : DEMO=1.
 *   DEMO=1 pnpm exec playwright test e2e/deals-demo.spec.ts --project=mobile-390
 * Données de DÉMONSTRATION dans le faux Supabase des tests (jamais en production).
 */
import { mkdirSync } from 'node:fs';
import { expect, test } from './fixtures';

test.skip(!process.env['DEMO'], 'démo à la demande : DEMO=1');

const SHOTS = 'qa/deals';

test('démo deals et gains', async ({ browser, supabase }) => {
  test.setTimeout(240_000);
  mkdirSync(SHOTS, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: 'http://localhost:4174',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    recordVideo: { dir: 'qa/demo/.raw/deals', size: { width: 390, height: 844 } },
  });
  const page = await ctx.newPage();
  await page.route('https://e2e-stacker.supabase.co/**', async (route) => {
    if (!(await supabase.fake.handle(route))) await route.fulfill({ status: 404, json: {} });
  });
  let n = 0;
  const shot = async (name: string, full = false) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full });
  };
  const pause = (ms = 1100) => page.waitForTimeout(ms);

  const user = supabase.fake.seedUser({ email: 'ines@exemple.fr', password: 'Plombier-Avignon-2026', firstName: 'Inès', onboarded: true, profile: { last_name: 'Martin', phone: '+33611223344', department: '30' } });
  supabase.fake.prospects.claims.push({
    id: '00000000-0000-4000-8000-0000000001aa',
    stacker: user.id,
    siret: '30000001200017',
    status: 'a_repondu',
    claimed_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    extended: false,
    next_action_at: null,
    contact_phone: '+33490123456',
    contact_email: 'contact@menuiserie-blanc.fr',
    contact_email_kind: 'generique',
    contact_source: 'https://menuiserie-blanc.fr/contact',
    released_at: null,
    release_reason: null,
  });

  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill('ines@exemple.fr');
  await page.getByLabel('Mot de passe', { exact: true }).fill('Plombier-Avignon-2026');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();

  await page.goto('/app/prospects/00000000-0000-4000-8000-0000000001aa');
  await expect(page.getByRole('link', { name: 'Faire signer ce client' })).toBeVisible();
  await pause();
  await shot('fiche-prospect');
  await page.getByRole('link', { name: 'Faire signer ce client' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'L’offre' })).toBeVisible();
  await pause();
  await shot('offre');
  await page.getByRole('radio', { name: /^Pro/ }).first().click();
  await pause(700);
  await shot('offre-choisie');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Le client' })).toBeVisible();
  await pause();
  await shot('client', true);
  await page.getByLabel('Email').fill('paul@menuiserie-blanc.fr');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('IBAN').pressSequentially('FR76 3000 6000 0112 3456 7890 189', { delay: 25 });
  await page.getByLabel(/autorise Stacker/).check();
  await pause(600);
  await shot('paiement');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Contrat et signature' })).toBeVisible();
  await pause();
  await shot('contrat');
  await page.getByLabel(/J’ai lu le contrat/).check();
  const pad = page.getByTestId('signature-pad');
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 30, box.y + box.height * 0.6);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) await page.mouse.move(box.x + 30 + i * 9, box.y + box.height * (0.55 + 0.25 * Math.sin(i / 2)), { steps: 3 });
    await page.mouse.up();
  }
  await pause(600);
  await shot('signature');
  await page.getByRole('button', { name: 'Signer le contrat' }).click();
  await expect(page.getByRole('heading', { name: 'SIGNÉ !' })).toBeVisible();
  await pause(2200);
  await shot('signe');
  await page.getByRole('button', { name: 'Voir le deal' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Menuiserie Blanc 12' })).toBeVisible();
  await pause();
  await shot('fiche-deal');
  await page.getByRole('link', { name: 'Mes deals' }).click();
  await pause();
  await shot('deals');

  // Le client a payé (DÉMO) : la commission apparaît dans Gains.
  const deal = supabase.fake.deals.deals[0];
  if (deal) supabase.fake.deals.recordPayment(deal.id, '2026-11-01', deal.monthly_price_cents, -1);
  await page.getByRole('navigation', { name: 'Navigation de l’application' }).getByRole('link', { name: 'Gains' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Gains' })).toBeVisible();
  await pause();
  await shot('gains');
  await page.mouse.wheel(0, 700);
  await pause();
  await shot('gains-suite');
  await ctx.close();
});
