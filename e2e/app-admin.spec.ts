/**
 * Lot 8 : espace admin. Accès réservé ; vue d'ensemble ; virement à faire
 * avec l'IBAN complet, marqué versé ; deal résilié avec motif ; offre
 * désactivée ; interrupteur avec confirmation ; journal.
 */
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { TEST_OFFERS } from './fake-deals';
import type { FakeSupabase } from './fake-supabase';
import { expect, expectAccessible, expectNoHorizontalOverflow, test } from './fixtures';

const PASSWORD = 'Plombier-Avignon-2026';

async function login(page: Page, email: string) {
  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation de l’application' })).toBeVisible();
}

/** Données de TEST : un stacker, un deal actif, un virement demandé. */
function seed(fake: FakeSupabase) {
  const ines = fake.seedUser({ email: 'ines@exemple.fr', password: PASSWORD, firstName: 'Inès', onboarded: true, profile: { last_name: 'Martin' } });
  const lucas = fake.seedUser({ email: 'lucas@exemple.fr', password: PASSWORD, firstName: 'Lucas', onboarded: true, profile: { last_name: 'Admin' } });
  fake.admin.admins.add(lucas.id);
  const offer = TEST_OFFERS[1]!;
  fake.deals.deals.push({
    id: '00000000-0000-4000-8000-0000000d0001',
    reference: 'STK-AB12CD34',
    stacker: ines.id,
    claim_id: null,
    offer,
    quantity: 1,
    monthly_price_cents: offer.price_cents,
    input: { company_name: 'Menuiserie Blanc', siret: '30000001200017', email: 'contact@menuiserie-blanc.fr', phone: '+33490123456' },
    iban_last4: '0189',
    mandate_ref: 'STKMAB12CD34',
    contract_text: 'Contrat de test',
    contract_sha256: 'a'.repeat(64),
    signature_png: 'data:image/png;base64,AAAA',
    signed_at: new Date().toISOString(),
    withdrawal_until: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    status: 'actif',
    activated_at: new Date().toISOString(),
  });
  fake.deals.accounts.set(ines.id, { holder: 'Inès Martin', iban_last4: '7034', iban: 'BE68539007547034' });
  fake.deals.payouts.push({ id: '00000000-0000-4000-8000-0000000f0001', stacker: ines.id, amount_cents: 1049, status: 'demande', iban_last4: '7034', requested_at: new Date().toISOString(), processed_at: null });
}

test.describe('admin', () => {
  test('virement, deal, offre, interrupteur, journal', async ({ page, supabase }, info) => {
    test.slow();
    seed(supabase.fake);
    await login(page, 'lucas@exemple.fr');
    await page.goto('/app/profil');
    await page.getByRole('link', { name: /Admin/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Admin' })).toBeVisible();
    await expect(page.getByText('1 virement(s) à faire')).toBeVisible();
    await expectAccessible(page, 'admin');
    await expectNoHorizontalOverflow(page, 'admin');
    // Captures pour relecture visuelle, à la demande : DEMO=1.
    const shots = `qa/admin/${info.project.name}`;
    const shot = async (name: string) => {
      if (!process.env['DEMO']) return;
      mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
    };
    await shot('1-vue');

    // Virement : IBAN complet pour le faire, puis marqué versé.
    await page.getByRole('button', { name: /virement\(s\) à faire/ }).click();
    await expect(page.getByText('BE68 5390 0754 7034')).toBeVisible();
    await expect(page.getByText('ines@exemple.fr')).toBeVisible();
    await shot('2-virements');
    await page.getByRole('button', { name: 'Marquer versé' }).click();
    await page.getByLabel(/Référence du virement/).fill('VIR-001');
    await page.getByRole('button', { name: 'Confirmer : virement fait' }).click();
    await expect(page.getByText('Aucun virement à faire.')).toBeVisible();
    expect(supabase.fake.deals.payouts[0]?.status).toBe('verse');

    // Deal : résiliation avec motif obligatoire.
    await page.getByRole('button', { name: 'Deals', exact: true }).click();
    await page.getByLabel('Rechercher un deal').fill('menuiserie');
    await page.getByRole('button', { name: 'Chercher' }).click();
    await expect(page.getByText('STK-AB12CD34', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Résilier', exact: true }).click();
    const confirm = page.getByRole('button', { name: 'Résilier le contrat' });
    await expect(confirm).toBeDisabled();
    await page.getByLabel('Motif', { exact: true }).fill('Demande du client par email');
    await confirm.click();
    await expect.poll(() => supabase.fake.deals.deals[0]?.status).toBe('resilie');

    // Offre désactivée.
    await page.getByRole('button', { name: 'Offres', exact: true }).click();
    const starter = page.getByRole('switch', { name: 'Alma Company Starter proposée aux stackers' });
    await expect(starter).toHaveAttribute('aria-checked', 'true');
    await starter.click();
    await expect(starter).toHaveAttribute('aria-checked', 'false');

    // Interrupteur : confirmation avant d'agir.
    await page.getByRole('button', { name: 'Réglages', exact: true }).click();
    await page.getByRole('switch', { name: 'Abonnement obligatoire' }).click();
    await page.getByRole('button', { name: 'Confirmer : activer' }).click();
    await expect(page.getByRole('switch', { name: 'Abonnement obligatoire' })).toHaveAttribute('aria-checked', 'true');
    expect(supabase.fake.billing.required).toBe(true);
    await shot('3-reglages');

    await page.getByRole('button', { name: 'Vue d’ensemble' }).click();
    for (const label of ['Virement versé', 'Deal résilié', 'Offre désactivée', 'Interrupteur · billing_required activé']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('stacker : pas de lien, accès refusé', async ({ page, supabase }) => {
    seed(supabase.fake);
    await login(page, 'ines@exemple.fr');
    await page.goto('/app/profil');
    await expect(page.getByRole('link', { name: 'Abonnement' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Admin/ })).toHaveCount(0);
    await page.goto('/app/admin');
    await expect(page.getByText('Accès réservé à l’équipe Stacker.')).toBeVisible();
    expect(supabase.fake.calls.some((c) => c.path === '/rest/v1/rpc/admin_payouts')).toBe(false);
  });
});
