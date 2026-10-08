/**
 * Vidéo de démonstration de l'onglet Campagne (à la demande : DEMO=1).
 *   DEMO=1 pnpm exec playwright test e2e/campaign-demo.spec.ts --project=mobile-390
 * produit qa/demo/.raw/campaign/*.webm, converti ensuite en qa/demo/campagne.mp4.
 */
import { expect, test } from './fixtures';

test.skip(!process.env['DEMO'], 'vidéo à la demande : DEMO=1');

test('démo : campagne de prospection', async ({ browser, supabase }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    baseURL: 'http://localhost:4174',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    recordVideo: { dir: 'qa/demo/.raw/campaign', size: { width: 390, height: 844 } },
  });
  const page = await ctx.newPage();
  await page.route('https://e2e-stacker.supabase.co/**', async (route) => {
    if (!(await supabase.fake.handle(route))) await route.fulfill({ status: 404, json: {} });
  });
  supabase.fake.seedUser({ email: 'ines@exemple.fr', password: 'Plombier-Avignon-2026', firstName: 'Inès', onboarded: true, profile: { last_name: 'Martin', department: '30' } });
  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill('ines@exemple.fr');
  await page.getByLabel('Mot de passe', { exact: true }).fill('Plombier-Avignon-2026');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('navigation', { name: 'Navigation de l’application' }).getByRole('link', { name: 'Prospects' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'J’ai compris, je m’engage' }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Connecter Gmail' }).click();
  await expect(page.getByText('ines.martin@gmail.com')).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Artisans du bâtiment' }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Artisans du bâtiment' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '200', exact: true }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Lancer la campagne' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Lancer la campagne' }).click();
  const run = page.getByRole('region', { name: /Artisans du bâtiment/ });
  await expect(run).toBeVisible();
  await run.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  await ctx.close();
});
