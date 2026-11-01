/**
 * Lot 6 : abonnement stacker. Abonnement exigé → bandeau et actions
 * bloquées ; page Abonnement (offre de lancement, places restantes) ; page
 * de paiement Mollie (simulée) ; retour, confirmation par le webhook
 * (simulé), abonnement actif ; résiliation puis reprise.
 */
import type { Page } from '@playwright/test';
import { CHECKOUT_URL } from './fake-billing';
import type { FakeSupabase } from './fake-supabase';
import { expect, expectAccessible, expectNoHorizontalOverflow, test } from './fixtures';

const PASSWORD = 'Plombier-Avignon-2026';

async function login(page: Page, fake: FakeSupabase) {
  const user = fake.seedUser({ email: 'ines@exemple.fr', password: PASSWORD, firstName: 'Inès', onboarded: true, profile: { last_name: 'Martin', phone: '+33611223344', department: '30' } });
  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill('ines@exemple.fr');
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation de l’application' })).toBeVisible();
  return user;
}

test.describe('abonnement', () => {
  test('exigé : bandeau, paiement Mollie, confirmation, résiliation et reprise', async ({ page, supabase }) => {
    test.slow();
    supabase.fake.billing.required = true;
    const user = await login(page, supabase.fake);
    // Page Mollie simulée : on ne quitte jamais le navigateur de test.
    await page.route('https://www.mollie.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Mollie</title><h1>Paiement de test</h1>' }));

    await page.goto('/app/deals');
    const banner = page.getByRole('status').filter({ hasText: 'Active ton abonnement pour faire signer tes clients.' });
    await expect(banner).toBeVisible();
    await banner.getByRole('link', { name: 'Activer' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Abonnement' })).toBeVisible();
    // Trois formules, Academy + Pro choisie par défaut.
    const plans = page.getByRole('radiogroup', { name: 'Formule' });
    await expect(plans.getByRole('radio')).toHaveText([/Academy \+ Pro.*14,99/, /Pro.*9,99/, /Academy.*12,99/]);
    await expect(plans.getByRole('radio', { name: /Academy \+ Pro/ })).toHaveAttribute('aria-checked', 'true');
    await plans.getByRole('radio', { name: /^Pro/ }).click();
    await expect(page.getByRole('button', { name: 'Payer 9,99 € et activer' })).toBeVisible();
    await plans.getByRole('radio', { name: /Academy \+ Pro/ }).click();
    await expect(page.getByText('Offre de lancement')).toBeVisible();
    await expect(page.getByText('100 places de lancement restantes')).toBeVisible();
    await expect(page.getByText('0 % prélevé sur tes commissions pendant 12 mois')).toBeVisible();
    await expectAccessible(page, 'abonnement');
    await expectNoHorizontalOverflow(page, 'abonnement');

    // Sans les deux cases : rien ne part.
    await page.getByRole('button', { name: 'Payer 14,99 € et activer' }).click();
    await expect(page.getByText('Accepte les conditions générales de vente pour continuer.')).toBeVisible();
    await expect(page.getByText('Coche cette case pour accéder aux outils dès maintenant.')).toBeVisible();
    expect(supabase.fake.calls.some((c) => c.path === '/functions/v1/billing-checkout')).toBe(false);
    await page.getByLabel(/J’accepte les conditions générales de vente/).check();
    await page.getByLabel(/Je demande l’accès aux outils dès maintenant/).check();
    await page.getByRole('button', { name: 'Payer 14,99 € et activer' }).click();
    await page.waitForURL(CHECKOUT_URL);
    const checkout = supabase.fake.calls.find((c) => c.path === '/functions/v1/billing-checkout');
    expect(checkout?.headers['authorization']).toMatch(/^Bearer /);
    expect(checkout?.body).toMatchObject({ accept_terms: true, immediate_start: true, plan: 'duo' });

    // Mollie confirme le paiement (webhook), puis le stacker revient sur l'app.
    supabase.fake.billing.confirmPayment(user.id);
    await page.goto('/app/abonnement?retour=1');
    await expect(page.getByText('Paiement confirmé : ton abonnement est actif.')).toBeVisible();
    await expect(page.getByText('Membre du lancement')).toBeVisible();
    await expect(page.getByText('Carte •••• 4242')).toBeVisible();
    await expect(page.getByText('Prochain renouvellement')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Academy \+ Pro · 14,99/ })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: '14,99 €' }).getByText('Payé')).toBeVisible();

    // Changer de formule : appliqué au prochain renouvellement.
    await page.getByRole('button', { name: 'Changer de formule' }).click();
    await page.getByRole('radiogroup', { name: 'Formule' }).getByRole('radio', { name: /^Pro/ }).click();
    await page.getByRole('button', { name: 'Passer à Pro au prochain renouvellement' }).click();
    await expect(page.locator('.billing-change')).toContainText(/Passage à Pro \(9,99\s€ \/ mois\) le/);

    await page.getByRole('button', { name: 'Résilier mon abonnement' }).click();
    await page.getByRole('button', { name: 'Confirmer la résiliation' }).click();
    await expect(page.getByText('Résilié', { exact: true })).toBeVisible();
    await expect(page.getByText('Accès jusqu’au')).toBeVisible();
    await page.getByRole('button', { name: 'Reprendre mon abonnement' }).click();
    await expect(page.getByRole('button', { name: 'Résilier mon abonnement' })).toBeVisible();

    await page.goto('/app/deals');
    await expect(page.getByRole('heading', { level: 2, name: 'Ton client est prêt ?' })).toBeVisible();
    await expect(page.getByText('Active ton abonnement pour faire signer tes clients.')).toHaveCount(0);
  });

  test('sans abonnement exigé : aucun bandeau, profil renvoie vers l’abonnement', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    await page.goto('/app/prospects');
    await expect(page.getByRole('heading', { level: 1, name: 'Prospects' })).toBeVisible();
    await expect(page.getByText(/Active ton abonnement/)).toHaveCount(0);
    await page.goto('/app/profil');
    await page.getByRole('link', { name: /Abonnement/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Abonnement' })).toBeVisible();
    await expect(page.getByText('L’abonnement n’est pas encore demandé')).toBeVisible();
  });

  test('exigé et absent : signature refusée avec un message clair', async ({ page, supabase }) => {
    supabase.fake.billing.required = true;
    await login(page, supabase.fake);
    await page.goto('/app/deals/nouveau');
    await expect(page.getByText('Active ton abonnement pour faire signer ce client.')).toBeVisible();
  });

  test('formule Academy seule : entraînement ouvert, prospection fermée ; formule Pro : Academy verrouillée', async ({ page, supabase }) => {
    supabase.fake.billing.required = true;
    const user = await login(page, supabase.fake);
    await page.route('https://www.mollie.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Mollie</title>' }));

    // Sans formule : l'Academy est verrouillée et renvoie vers les formules.
    await page.goto('/app/academy');
    const lock = page.getByRole('status').filter({ hasText: 'L’Academy n’est pas dans ta formule' });
    await expect(lock).toContainText('12,99');
    await expectAccessible(page, 'academy verrouillée');
    await lock.getByRole('link', { name: 'Voir les formules' }).click();

    // Formule Academy (12,99 €).
    await page.getByRole('radiogroup', { name: 'Formule' }).getByRole('radio', { name: /^Academy 12,99/ }).click();
    await page.getByLabel(/J’accepte les conditions générales de vente/).check();
    await page.getByLabel(/Je demande l’accès aux outils dès maintenant/).check();
    await page.getByRole('button', { name: 'Payer 12,99 € et activer' }).click();
    await page.waitForURL(/mollie\.com/);
    supabase.fake.billing.confirmPayment(user.id);
    await page.goto('/app/academy');
    await expect(page.getByRole('heading', { level: 1, name: /Stacker Academy/ })).toBeVisible();
    await expect(page.getByText('L’Academy n’est pas dans ta formule')).toHaveCount(0);
    await page.goto('/app/deals/nouveau');
    await expect(page.getByText('Active ton abonnement pour faire signer ce client.')).toBeVisible();
    await page.goto('/app/formation');
    await expect(page.getByRole('heading', { level: 1, name: 'Formation' })).toBeVisible();
    await expect(page.getByText('L’Academy n’est pas dans ta formule')).toHaveCount(0);
  });
});
