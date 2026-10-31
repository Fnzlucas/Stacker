/**
 * iPhone dans Safari : l'accueil propose d'installer Stacker sur l'écran
 * d'accueil (3 gestes), refermable, et plus jamais affiché ensuite.
 */
import type { Page } from '@playwright/test';
import type { FakeSupabase } from './fake-supabase';
import { expect, expectAccessible, test } from './fixtures';

const PASSWORD = 'Plombier-Avignon-2026';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function login(page: Page, fake: FakeSupabase) {
  fake.seedUser({ email: 'ines@exemple.fr', password: PASSWORD, firstName: 'Inès', onboarded: true });
  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill('ines@exemple.fr');
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();
}

test.describe('installation sur iPhone', () => {
  test.use({ userAgent: SAFARI_IPHONE });

  test('Safari sur iPhone : carte d’installation, refermable', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    const card = page.getByRole('region', { name: 'Installe Stacker sur ton iPhone' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Sur l’écran d’accueil');
    await expectAccessible(page, 'installation iPhone');
    await card.getByRole('button', { name: 'Fermer' }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Installe Stacker sur ton iPhone' })).toHaveCount(0);
  });
});

test('ordinateur ou Android : pas de carte d’installation', async ({ page, supabase }) => {
  await login(page, supabase.fake);
  await expect(page.getByRole('region', { name: 'Installe Stacker sur ton iPhone' })).toHaveCount(0);
});
