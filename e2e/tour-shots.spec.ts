/**
 * Tour visuel de l'app (données de DÉMONSTRATION du faux Supabase, jamais en
 * production) : captures mobiles des écrans principaux dans qa/tour/.
 *   SHOTS=1 pnpm exec playwright test e2e/tour-shots.spec.ts --project=mobile-390
 */
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { TEST_OFFERS } from './fake-deals';
import { expect, test } from './fixtures';

const DIR = 'qa/apercu';
const PASSWORD = 'Plombier-Avignon-2026';

async function shot(page: Page, name: string, fullPage = false) {
  await expect(page.locator('.app-splash, #boot')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage, animations: 'disabled' });
}

test('tour de l’app', async ({ page, supabase }) => {
  test.skip(!process.env['SHOTS'], 'captures à la demande : SHOTS=1');
  test.setTimeout(180_000);
  mkdirSync(DIR, { recursive: true });
  const fake = supabase.fake;
  const user = fake.seedUser({ email: 'ines@exemple.fr', password: PASSWORD, firstName: 'Inès', onboarded: true, profile: { last_name: 'Martin', phone: '+33611223344', department: '30' } });
  const now = Date.now();
  const sirets = ['30000001200017', '30000000500017', '30000000400017'];
  ['a_repondu', 'contacte', 'rdv'].forEach((status, i) =>
    fake.prospects.claims.push({
      id: `00000000-0000-4000-8000-0000000001a${String(i)}`,
      stacker: user.id,
      siret: sirets[i] ?? sirets[0]!,
      status,
      claimed_at: new Date(now - i * 86_400_000).toISOString(),
      expires_at: new Date(now + 10 * 86_400_000).toISOString(),
      extended: false,
      next_action_at: null,
      contact_phone: '+33490123456',
      contact_email: 'contact@entreprise-test.fr',
      contact_email_kind: 'generique',
      contact_source: 'https://entreprise-test.fr/contact',
      released_at: null,
      release_reason: null,
    }),
  );
  const companies = ['Menuiserie Blanc', 'Boulangerie Martin', 'Garage du Pont'];
  companies.forEach((name, i) => {
    const offer = TEST_OFFERS[i % 2]!;
    const id = `00000000-0000-4000-8000-0000000d000${String(i)}`;
    fake.deals.deals.push({
      id,
      reference: `STK-0000AB${String(i)}0`,
      stacker: user.id,
      claim_id: null,
      offer,
      quantity: 1,
      monthly_price_cents: offer.price_cents,
      input: { company_name: name, siret: '30000001200017', email: 'contact@test.fr', phone: '+33490123456' },
      iban_last4: '0189',
      mandate_ref: `STKM0000AB${String(i)}0`,
      contract_text: 'Contrat de démonstration',
      contract_sha256: 'a'.repeat(64),
      signature_png: 'data:image/png;base64,AAAA',
      signed_at: new Date(now - (20 + i * 10) * 86_400_000).toISOString(),
      withdrawal_until: new Date(now - (6 + i * 10) * 86_400_000).toISOString(),
      status: 'signe',
      activated_at: null,
    });
    if (i < 2) fake.deals.recordPayment(id, '2026-10-01', offer.price_cents, i === 0 ? -1 : 9);
  });
  fake.deals.accounts.set(user.id, { holder: 'Inès Martin', iban_last4: '7034', iban: 'BE68539007547034' });

  await page.goto('/app/connexion');
  await shot(page, '01-connexion');
  await page.getByLabel('Adresse email').fill('ines@exemple.fr');
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();
  await shot(page, '02-accueil', true);
  await page.goto('/app/prospects?vue=mes');
  await shot(page, '03-prospects', true);
  await page.goto('/app/prospects?vue=trouver');
  await shot(page, '04-recherche', true);
  await page.goto('/app/prospects/00000000-0000-4000-8000-0000000001a0');
  await shot(page, '05-fiche-prospect', true);
  await page.goto('/app/deals');
  await shot(page, '06-deals', true);
  await page.goto('/app/deals/nouveau');
  await shot(page, '07-faire-signer', true);
  await page.goto('/app/gains');
  await shot(page, '08-gains', true);
  await page.goto('/app/abonnement');
  await shot(page, '09-abonnement', true);
  await page.goto('/app/formation?module=appel');
  await shot(page, '10-formation');
  await page.goto('/app/profil');
  await shot(page, '11-profil', true);
  await page.goto('/');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/12-landing.png`, fullPage: true, animations: 'disabled' });
});
