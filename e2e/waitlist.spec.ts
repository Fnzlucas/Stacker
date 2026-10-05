import type { Page } from '@playwright/test';
import { UNCONFIGURED, expect, expectAccessible, expectNoHorizontalOverflow, test } from './fixtures';

async function fill(page: Page, form = page.getByTestId('waitlist-form')) {
  await form.getByLabel('Prénom').fill('Inès');
  await form.getByLabel('Adresse email').fill('  INES@Exemple.fr ');
  await form.getByLabel(/Département/).selectOption('84');
  await form.getByLabel('Je déclare avoir 18 ans ou plus.').check();
  await form.getByLabel(/J’accepte les conditions d’utilisation/).check();
  return form;
}

test.describe('liste d’attente (Supabase simulé)', () => {
  test('compteur public : le vrai nombre renvoyé par Supabase, une seule requête', async ({ page, supabase }) => {
    supabase.count = 1234;
    await page.goto('/');
    await expect(page.getByTestId('waitlist-count').first()).toContainText('1 234 personnes inscrites');
    await expect(page.getByTestId('waitlist-count')).toHaveCount(2);
    expect(supabase.countCalls).toBe(1);
  });

  test('compteur en erreur : rien n’est affiché (jamais de chiffre inventé)', async ({ page, supabase }) => {
    supabase.count = null;
    await page.goto('/tarifs');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('waitlist-count')).toHaveCount(0);
  });

  test('inscription réussie depuis la landing : position, lien de parrainage, données envoyées', async ({ page, supabase }) => {
    await page.goto('/?ref=k7m2p9qr#rejoindre');
    const form = await fill(page);
    await form.getByLabel(/Facultatif/).check();
    await form.getByRole('button', { name: 'Rejoindre la liste d’attente' }).click();

    const success = page.getByTestId('waitlist-success');
    await expect(success).toBeVisible();
    await expect(success.getByRole('heading', { level: 2 })).toHaveAccessibleName('Tu es numéro 42 sur la liste d’attente');
    await expect(success.getByRole('heading', { level: 2 })).toBeFocused();
    await expect(success).toContainText('Tu fais partie des 100 premiers inscrits');
    await expect(success.locator('code')).toHaveText('http://localhost:4174/liste-attente?ref=K7M2P9QR');

    expect(supabase.joinCalls).toHaveLength(1);
    const call = supabase.joinCalls[0]!;
    expect(call.body).toEqual({
      firstName: 'Inès',
      email: 'ines@exemple.fr',
      department: '84',
      ageConfirmed: true,
      termsAccepted: true,
      marketingOptIn: true,
      referralCode: 'K7M2P9QR',
    });
    // Seule la clé publique part du navigateur.
    expect(call.headers['apikey']).toBe('sb_publishable_e2e_test_key');
    await expectNoHorizontalOverflow(page, 'succès');
    await expectAccessible(page, 'succès inscription');
  });

  test('adresse déjà inscrite : message neutre, aucune position ni lien affichés', async ({ page, supabase }) => {
    supabase.join = { status: 200, body: { ok: true, status: 'already_registered' } };
    await page.goto('/liste-attente');
    const form = await fill(page);
    await form.getByRole('button', { name: 'Rejoindre la liste d’attente' }).click();

    const already = page.getByTestId('waitlist-already');
    await expect(already).toBeVisible();
    await expect(already.getByRole('heading', { level: 2 })).toBeFocused();
    await expect(already).toContainText('Cette adresse est déjà sur la liste d’attente.');
    await expect(already.locator('code')).toHaveCount(0);
    await expect(page.getByTestId('waitlist-success')).toHaveCount(0);
    await expectAccessible(page, 'déjà inscrit');
  });

  test('position au-delà de 100 : message de priorité sans promesse', async ({ page, supabase }) => {
    supabase.join = {
      status: 200,
      body: { ok: true, status: 'joined', position: 250, referralCode: 'ABCDEFGH', referralUrl: 'http://localhost:4174/liste-attente?ref=ABCDEFGH' },
    };
    await page.goto('/liste-attente');
    const form = await fill(page);
    await form.getByRole('button', { name: 'Rejoindre la liste d’attente' }).click();
    const success = page.getByTestId('waitlist-success');
    await expect(success).toContainText('Les inscrits ont priorité sur les 100 places');
    await expect(success).not.toContainText('Tu fais partie');
  });

  test('validation côté navigateur : erreurs lisibles, focus sur le premier champ, aucun envoi', async ({ page, supabase }) => {
    await page.goto('/liste-attente');
    const form = page.getByTestId('waitlist-form');
    await form.getByRole('button', { name: 'Rejoindre la liste d’attente' }).click();
    await expect(form.getByText('Indique ton prénom')).toBeVisible();
    await expect(form.getByText('Indique une adresse email valide.')).toBeVisible();
    await expect(form.getByText('Stacker est réservé aux personnes majeures.')).toBeVisible();
    await expect(form.getByText('Tu dois accepter les CGU')).toBeVisible();
    await expect(form.getByLabel('Prénom')).toBeFocused();
    await expect(form.getByLabel('Prénom')).toHaveAttribute('aria-invalid', 'true');
    expect(supabase.joinCalls).toHaveLength(0);
    await expectAccessible(page, 'formulaire en erreur');

    await form.getByLabel('Prénom').fill('Inès');
    await expect(form.getByText('Indique ton prénom')).toHaveCount(0);
  });

  test('erreur de champ renvoyée par le serveur : affichée sous le champ', async ({ page, supabase }) => {
    supabase.join = { status: 400, body: { ok: false, error: 'invalid_request', fields: { email: 'Indique une adresse email valide.' } } };
    await page.goto('/liste-attente');
    const form = await fill(page);
    await form.getByRole('button', { name: 'Rejoindre la liste d’attente' }).click();
    await expect(form.getByRole('alert')).toContainText('Certains champs sont à corriger.');
    await expect(form.getByText('Indique une adresse email valide.')).toBeVisible();
    await expect(form.getByLabel('Adresse email')).toBeFocused();
  });

  test('rate limit serveur : message clair, le formulaire reste utilisable', async ({ page, supabase }) => {
    supabase.join = { status: 429, body: { ok: false, error: 'rate_limited' } };
    await page.goto('/liste-attente');
    const form = await fill(page);
    await form.getByRole('button', { name: 'Rejoindre la liste d’attente' }).click();
    await expect(form.getByRole('alert')).toContainText('Trop de tentatives');
    await expect(form.getByRole('button', { name: 'Rejoindre la liste d’attente' })).toBeEnabled();
  });

  test('Turnstile désactivé (pas de clé de site) : aucun script Cloudflare chargé', async ({ page }) => {
    const cloudflare: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('challenges.cloudflare.com')) cloudflare.push(r.url());
    });
    await page.goto('/liste-attente', { waitUntil: 'networkidle' });
    await page.getByTestId('waitlist-form').scrollIntoViewIfNeeded();
    expect(cloudflare).toEqual([]);
  });

  test('clavier : le formulaire se remplit et s’envoie sans souris', async ({ page, supabase, isMobile }) => {
    test.skip(isMobile, 'navigation clavier vérifiée sur desktop');
    await page.goto('/liste-attente');
    const form = page.getByTestId('waitlist-form');
    await form.getByLabel('Prénom').focus();
    await page.keyboard.type('Inès');
    await page.keyboard.press('Tab');
    await page.keyboard.type('ines@exemple.fr');
    await page.keyboard.press('Tab'); // département (facultatif)
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab'); // lien CGU
    await page.keyboard.press('Tab'); // lien confidentialité
    await form.getByLabel(/J’accepte les conditions d’utilisation/).focus();
    await page.keyboard.press('Space');
    await form.getByRole('button', { name: 'Rejoindre la liste d’attente' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('waitlist-success')).toBeVisible();
    expect(supabase.joinCalls).toHaveLength(1);
  });
});

test.describe('site sans Supabase configuré', () => {
  test('formulaire désactivé avec un message, aucun compteur, aucun appel réseau', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      if (!r.url().startsWith(UNCONFIGURED)) external.push(r.url());
    });
    await page.goto(`${UNCONFIGURED}/liste-attente`, { waitUntil: 'networkidle' });
    const form = page.getByTestId('waitlist-form');
    await expect(form.getByRole('status').first()).toContainText('Les inscriptions à la liste d’attente ne sont pas encore ouvertes');
    await expect(form.getByLabel('Prénom')).toBeDisabled();
    await expect(form.getByRole('button', { name: 'Rejoindre la liste d’attente' })).toBeDisabled();
    await expect(page.getByTestId('waitlist-count')).toHaveCount(0);
    expect(external).toEqual([]);
    await expectNoHorizontalOverflow(page, 'non configuré');
    await expectAccessible(page, 'formulaire non configuré');
  });

  test('le reste du site fonctionne normalement', async ({ page }) => {
    for (const path of ['/', '/tarifs', '/cgv', '/mentions-legales']) {
      const res = await page.goto(`${UNCONFIGURED}${path}`);
      expect(res?.status()).toBe(200);
      await expect(page.locator('h1')).toBeVisible();
    }
  });
});
