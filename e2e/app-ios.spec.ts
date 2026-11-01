/**
 * Application iPhone (App Store) : aucun prix, aucun bouton ni lien de
 * paiement, aucun renvoi vers le site pour s'abonner (règles de l'App Store).
 * L'app native est simulée par l'objet Capacitor que l'application iPhone
 * injecte dans la page.
 */
import type { Page } from '@playwright/test';
import type { FakeSupabase } from './fake-supabase';
import { expect, expectAccessible, test } from './fixtures';

const PASSWORD = 'Plombier-Avignon-2026';

async function login(page: Page, fake: FakeSupabase) {
  fake.seedUser({ email: 'ines@exemple.fr', password: PASSWORD, firstName: 'Inès', onboarded: true, profile: { last_name: 'Martin', phone: '+33611223344', department: '30' } });
  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill('ines@exemple.fr');
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation de l’application' })).toBeVisible();
}

test.describe('application iPhone', () => {
  test.beforeEach(async ({ page }) => {
    // Objet figé : le module web de Capacitor (chargé ensuite) ne peut pas le remplacer, comme dans la vraie app.
    await page.addInitScript(() => {
      const cap = Object.freeze({ isNativePlatform: () => true, getPlatform: () => 'ios' });
      Object.defineProperty(window, 'Capacitor', { get: () => cap, set: () => undefined, configurable: false });
    });
  });

  test('compte non actif : ni prix, ni paiement, ni lien vers le site', async ({ page, supabase }) => {
    supabase.fake.billing.required = true;
    await login(page, supabase.fake);

    await page.goto('/app/deals');
    const banner = page.getByRole('status').filter({ hasText: 'Ton compte n’est pas actif' });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('link')).toHaveCount(0);

    await page.goto('/app/profil');
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Abonnement/ })).toHaveCount(0);

    await page.goto('/app/abonnement');
    await expect(page.getByRole('heading', { level: 1, name: 'Mon compte' })).toBeVisible();
    await expect(page.getByText('Ton compte n’est pas actif.')).toBeVisible();
    const main = page.locator('main');
    await expect(main).not.toContainText(/€|payer|abonne|mollie|stacker-topaz|site/i);
    await expect(main.getByRole('button')).toHaveCount(0);
    await expectAccessible(page, 'compte iPhone');

    // Pas de carte « installe sur l'écran d'accueil » : on est déjà dans l'app.
    await page.goto('/app');
    await expect(page.getByRole('region', { name: 'Installe Stacker sur ton iPhone' })).toHaveCount(0);
  });

  test('compte actif : « Ton compte est actif »', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    await page.goto('/app/abonnement');
    await expect(page.getByText('Ton compte est actif.')).toBeVisible();
  });
});
