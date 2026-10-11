/**
 * Lot 5 : deals et gains. Faire signer un prospect (fiche pré-remplie →
 * offre → client → IBAN → contrat lu, accepté, signé au doigt → célébration),
 * contrôles de saisie, fiche du deal, prospect passé à « Signé », gains :
 * commissions en validation puis disponibles, IBAN de virement, demande de
 * virement de tout le solde.
 */
import type { Page } from '@playwright/test';
import type { FakeSupabase } from './fake-supabase';
import { expect, expectAccessible, expectNoHorizontalOverflow, test } from './fixtures';

const PASSWORD = 'Plombier-Avignon-2026';
const CLAIM_ID = '00000000-0000-4000-8000-0000000001aa';
/** Entreprise de TEST n° 12 du faux Supabase (SIRET valide). */
const SIRET = '30000001200017';

async function login(page: Page, fake: FakeSupabase) {
  const user = fake.seedUser({ email: 'ines@exemple.fr', password: PASSWORD, firstName: 'Inès', onboarded: true, profile: { last_name: 'Martin', phone: '+33611223344', department: '30' } });
  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill('ines@exemple.fr');
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation de l’application' })).toBeVisible();
  return user;
}

function seedClaim(fake: FakeSupabase, stacker: string) {
  fake.prospects.claims.push({
    id: CLAIM_ID,
    stacker,
    siret: SIRET,
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
}

async function sign(page: Page) {
  const pad = page.getByTestId('signature-pad');
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  if (!box) throw new Error('zone de signature invisible');
  await page.mouse.move(box.x + 30, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) await page.mouse.move(box.x + 30 + i * 11, box.y + box.height * (0.6 + 0.25 * Math.sin(i / 2)), { steps: 2 });
  await page.mouse.up();
}

test.describe('deals', () => {
  test('faire signer un prospect : pré-rempli, contrat serveur, signature, célébration, fiche', async ({ page, supabase }) => {
    test.slow();
    const user = await login(page, supabase.fake);
    seedClaim(supabase.fake, user.id);
    await page.goto(`/app/prospects/${CLAIM_ID}`);
    await page.getByRole('link', { name: 'Faire signer ce client' }).click();
    await expect(page).toHaveURL(/\/app\/deals\/nouveau\?prospect=/);

    // 1. Offre : catalogue actif uniquement, commission au taux du niveau.
    await expect(page.getByRole('heading', { level: 1, name: 'L’offre' })).toBeVisible();
    await expect(page.locator('main')).not.toContainText('RH PME');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByRole('alert').first()).toContainText('Choisis une offre.');
    const pro = page.getByRole('radio', { name: /^Pro/ });
    await pro.click();
    await expect(pro).toHaveAttribute('aria-checked', 'true');
    await expect(pro).toContainText('10,49');
    await expectAccessible(page, 'deal-offre');
    await expectNoHorizontalOverflow(page, 'deal-offre');
    await page.getByRole('button', { name: 'Continuer' }).click();

    // 2. Client : pré-rempli depuis la fiche prospect.
    await expect(page.getByRole('heading', { level: 1, name: 'Le client' })).toBeVisible();
    await expect(page.getByLabel('SIRET')).toHaveValue(SIRET);
    await expect(page.getByLabel('Raison sociale')).toHaveValue('Menuiserie Blanc 12');
    await expect(page.getByLabel('Email')).toHaveValue('contact@menuiserie-blanc.fr');
    await expect(page.getByLabel('Prénom')).toHaveValue('Paul');
    await expect(page.getByLabel('Nom', { exact: true })).toHaveValue('Durand');
    await page.getByLabel('Email').fill('pas-un-email');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByText('Adresse email invalide.')).toBeVisible();
    await page.getByLabel('Email').fill('paul@menuiserie-blanc.fr');
    await expectAccessible(page, 'deal-client');
    await page.getByRole('button', { name: 'Continuer' }).click();

    // 3. Paiement : IBAN contrôlé (clé), mandat obligatoire.
    await expect(page.getByRole('heading', { level: 1, name: 'Le paiement' })).toBeVisible();
    await page.getByLabel('IBAN').fill('FR76 3000 6000 0112 3456 7890 188');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByText('IBAN invalide : vérifie les chiffres.')).toBeVisible();
    await expect(page.getByText('Le client doit accepter le prélèvement.')).toBeVisible();
    await page.getByLabel('IBAN').fill('fr7630006000011234567890189');
    await page.getByLabel(/autorise Stacker/).check();
    await page.getByRole('button', { name: 'Continuer' }).click();

    // 4. Contrat rendu par le serveur, accord et signature du client.
    await expect(page.getByRole('heading', { level: 1, name: 'Contrat et signature' })).toBeVisible();
    const contract = page.getByLabel('Texte du contrat');
    await expect(contract).toHaveValue(/Menuiserie Blanc 12, SIRET 30000001200017/);
    await expect(contract).toHaveValue(/FR76 •••• •••• 0189/);
    await expect(contract).not.toHaveValue(/30006000011234567890/);
    await expect(page.getByText('Ta commission :')).toContainText('10,49');
    await page.getByRole('button', { name: 'Signer le contrat' }).click();
    await expect(page.getByText('Le client doit accepter le contrat.')).toBeVisible();
    await expect(page.getByText('La signature est vide ou trop courte.')).toBeVisible();
    await page.getByLabel(/J’ai lu le contrat/).check();
    await sign(page);
    await expectAccessible(page, 'deal-signature');
    await expectNoHorizontalOverflow(page, 'deal-signature');
    await page.getByRole('button', { name: 'Signer le contrat' }).click();

    // Célébration, puis fiche du deal.
    await expect(page.getByRole('heading', { name: 'SIGNÉ !' })).toBeVisible();
    await expect(page.getByText('Menuiserie Blanc 12', { exact: true })).toBeVisible();
    await expect(page.locator('.deal-win-amount')).toContainText('10,49', { timeout: 5000 });
    await page.getByRole('button', { name: 'Voir le deal' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Menuiserie Blanc 12' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Contrat signé. Le premier prélèvement a lieu après les 14 jours de rétractation');
    await expect(page.locator('main')).toContainText('FR•• •••• 0189');
    await expectAccessible(page, 'deal-fiche');

    // Le prospect est passé à « Signé » ; le deal apparaît dans la liste.
    expect(supabase.fake.prospects.claims.find((c) => c.id === CLAIM_ID)?.status).toBe('signe');
    expect(supabase.fake.deals.deals[0]?.signature_png).toMatch(/^data:image\/png;base64,/);
    await page.getByRole('link', { name: 'Mes deals' }).click();
    await expect(page.locator('.deals-list')).toContainText('Menuiserie Blanc 12');
    await expect(page.locator('.deals-list')).toContainText('Signé');
    await expect(page.locator('.deals-stats')).toContainText('1');
  });

  test('sans prospect : saisie libre, offre au nombre de chambres', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    await page.getByRole('navigation', { name: 'Navigation de l’application' }).getByRole('link', { name: 'Deals' }).click();
    await page.getByRole('link', { name: 'Faire signer un client' }).click();
    await page.getByRole('radio', { name: /Hôtel moyen/ }).click();
    await page.getByLabel('Nombre de chambres').fill('10');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByText('Entre 21 et 80 chambres.')).toBeVisible();
    await page.getByLabel('Nombre de chambres').fill('30');
    await expect(page.locator('.deal-qty-total')).toContainText('150');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByLabel('SIRET')).toHaveValue('');
    await page.getByRole('button', { name: 'Retour' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'L’offre' })).toBeVisible();
  });
});

test.describe('gains', () => {
  test('commissions en validation puis disponibles, IBAN, demande de virement', async ({ page, supabase }) => {
    const user = await login(page, supabase.fake);
    const fake = supabase.fake;
    // Deux deals signés de TEST, payés par les clients (données de test).
    fake.deals.deals.push(
      ...[1, 2].map((i) => ({
        id: `00000000-0000-4000-8000-0000000002b${String(i)}`,
        reference: `STK-T${String(i)}`,
        stacker: user.id,
        claim_id: null,
        offer: fake.deals.offers[1]!,
        quantity: 1,
        monthly_price_cents: 6999,
        input: { company_name: `Client test ${String(i)}`, siret: SIRET, company_address: 'adresse', first_name: 'A', last_name: 'B', role: 'Gérant', email: 'a@b.fr', phone: '+33600000000', iban: 'FR7630006000011234567890189' },
        iban_last4: '0189',
        mandate_ref: `RUM${String(i)}`,
        contract_text: 'contrat',
        contract_sha256: 'a'.repeat(64),
        signature_png: 'data:image/png;base64,AAAA',
        signed_at: new Date().toISOString(),
        withdrawal_until: new Date().toISOString(),
        status: 'signe' as const,
        activated_at: null,
      })),
    );
    fake.deals.recordPayment('00000000-0000-4000-8000-0000000002b1', '2026-11-01', 6999, -1);
    fake.deals.recordPayment('00000000-0000-4000-8000-0000000002b2', '2026-11-01', 6999, 20);

    await page.getByRole('navigation', { name: 'Navigation de l’application' }).getByRole('link', { name: 'Gains' }).click();
    const main = page.locator('main');
    await expect(main.locator('.balance-amount')).toHaveText('10,49 €');
    await expect(main.locator('.balance-split')).toContainText('10,49');
    await expect(main.getByText(/Prochaine commission disponible le/)).toBeVisible();
    await expect(main.locator('.gains-monthly-amount')).toContainText('20,99');
    await expect(main.getByText(/Disponible le/)).toBeVisible();
    await expectAccessible(page, 'gains-solde');
    await expectNoHorizontalOverflow(page, 'gains-solde');

    // IBAN de virement : contrôlé, puis virement de tout le solde disponible.
    await main.getByLabel('Titulaire du compte').fill('Inès Martin');
    await main.getByLabel('IBAN').fill('FR76 3000 6000 0112 3456 7890 188');
    await main.getByRole('button', { name: 'Enregistrer mon IBAN' }).click();
    await expect(main.getByText('IBAN invalide : vérifie les chiffres.')).toBeVisible();
    await main.getByLabel('IBAN').fill('FR76 3000 6000 0112 3456 7890 189');
    await main.getByRole('button', { name: 'Enregistrer mon IBAN' }).click();
    await expect(main.getByText('Vers Inès Martin · ••0189')).toBeVisible();
    await main.getByRole('button', { name: 'Virer sur mon compte' }).click();
    await expect(main.getByText(/Virement de 10,49.*en cours vers le compte ••0189/)).toBeVisible();
    await expect(main.locator('.balance-amount')).toHaveText('0,00 €');
    await expect(main.getByRole('button', { name: 'Virer sur mon compte' })).toBeDisabled();
    expect(fake.deals.payouts).toHaveLength(1);
    expect(fake.deals.payouts[0]?.amount_cents).toBe(1049);
  });
});
