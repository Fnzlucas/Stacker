/**
 * Lot 9 : formation. Accueil → formation, module ouvert, terminé (progression
 * enregistrée), script d'appel accessible depuis la fiche d'un prospect.
 */
import { expect, expectAccessible, expectNoHorizontalOverflow, test } from './fixtures';

const PASSWORD = 'Plombier-Avignon-2026';

test('formation : progression, scripts, accès depuis l’accueil', async ({ page, supabase }) => {
  const user = supabase.fake.seedUser({ email: 'ines@exemple.fr', password: PASSWORD, firstName: 'Inès', onboarded: true, profile: { last_name: 'Martin' } });
  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill('ines@exemple.fr');
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();

  await page.getByRole('link', { name: /Suivre la formation/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Formation' })).toBeVisible();
  await expect(page.getByText('0 module sur 8')).toBeVisible();
  await expectAccessible(page, 'formation');

  await page.getByText('Comment Stacker fonctionne', { exact: true }).click();
  await expect(page.getByText('Aucun revenu n’est garanti', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'J’ai terminé ce module' }).click();
  await expect(page.getByText('1 module sur 8')).toBeVisible();
  expect(supabase.fake.formation.get(user.id)).toEqual(['bases']);

  await page.goto('/app/formation?module=objections');
  await expect(page.getByText('« C’est trop cher. »')).toBeVisible();
  await expectNoHorizontalOverflow(page, 'formation');

  await page.goto('/app/formation?module=appel');
  await expect(page.getByText('Les 5 temps')).toBeVisible();
  // Capture pour relecture visuelle, à la demande : DEMO=1.
  if (process.env['DEMO']) await page.screenshot({ path: `qa/formation-${test.info().project.name}.png`, fullPage: true });
  await expect(page.getByText('1 module sur 8')).toBeVisible();

  await page.goto('/app');
  await expect(page.getByText('1 / 8 modules · scripts d’appel inclus')).toBeVisible();
});
