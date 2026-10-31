/**
 * Navigation : chaque écran s'ouvre en haut, et la checklist de l'accueil
 * amène directement sur le champ du profil à remplir.
 */
import { expect, test } from './fixtures';

const PASSWORD = 'Plombier-Avignon-2026';

test('checklist de l’accueil : le champ Ville est ouvert directement ; changer d’écran remonte en haut', async ({ page, supabase }) => {
  supabase.fake.seedUser({ email: 'ines@exemple.fr', password: PASSWORD, firstName: 'Inès', onboarded: true, profile: { last_name: 'Martin', phone: '+33611223344', department: '30' } });
  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill('ines@exemple.fr');
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();

  const city = page.getByRole('link', { name: /Indique ta ville/ });
  await city.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await city.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeAttached();
  const field = page.getByLabel('Ville (facultatif)');
  await expect(field).toBeFocused();
  await expect(field).toBeInViewport();

  // Bas de la formation, puis un onglet : le nouvel écran commence en haut.
  await page.goto('/app/formation');
  await expect(page.getByText('T’organiser et progresser', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await page.getByRole('navigation', { name: 'Navigation de l’application' }).getByRole('link', { name: 'Gains' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Gains' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});
