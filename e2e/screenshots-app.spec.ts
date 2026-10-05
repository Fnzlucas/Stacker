/**
 * Captures de recette visuelle de l'app connectée (lot 2) dans qa/shots-lot2/ :
 * chaque écran en 390×844 (densité 2), et les principaux en 1280×800.
 * Lancées à la demande : `pnpm qa:shots:app` (SHOTS=1).
 */
import type { Page } from '@playwright/test';
import type { FakeSupabase } from './fake-supabase';
import { expect, test } from './fixtures';

const DIR = 'qa/shots-lot2';
const PASSWORD = 'Plombier-Avignon-2026';

async function shot(page: Page, name: string, fullPage = false) {
  // Jamais l'écran de chargement : on attend la page rendue.
  await expect(page.locator('.app-splash, .app-boot')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage, animations: 'disabled' });
}

async function login(page: Page, fake: FakeSupabase, opts: Parameters<FakeSupabase['seedUser']>[0]) {
  fake.seedUser(opts);
  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill(opts.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(opts.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

test.describe('captures app', () => {
  test.skip(!process.env['SHOTS'], 'captures à la demande : SHOTS=1');
  test.setTimeout(120_000);
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('écrans d’authentification', async ({ page, supabase, isMobile }) => {
    const p = isMobile ? '' : 'desktop-';
    await page.goto('/app/connexion');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, `${p}connexion`, true);
    if (!isMobile) return;

    await page.goto('/app/inscription');
    await shot(page, 'inscription', true);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await shot(page, 'inscription-erreurs', true);

    const form = page.getByRole('form', { name: 'Création de compte' });
    await form.getByLabel('Prénom').fill('Inès');
    await form.getByLabel('Adresse email').fill('ines@exemple.fr');
    await form.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await form.getByLabel('Date de naissance').fill('1995-04-12');
    await form.getByLabel(/Je certifie être majeur/).check();
    await form.getByLabel(/J’accepte les conditions d’utilisation/).check();
    await page.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Vérifie ta boîte mail' })).toBeVisible();
    await shot(page, 'verifier-email', true);

    const mail = supabase.fake.lastEmail('ines@exemple.fr', 'signup')!;
    await page.goto(`/app/auth/confirmer?token_hash=${mail.tokenHash}&type=email`);
    await expect(page.getByRole('heading', { level: 1, name: 'Comment veux-tu qu’on t’appelle ?' })).toBeVisible();
    await shot(page, 'onboarding-1-prenom');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByLabel('Département').selectOption('84');
    await shot(page, 'onboarding-2-zone');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await page.getByText('Un complément de revenu').click();
    await shot(page, 'onboarding-3-objectif');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByText('25 clients actifs et plus')).toBeVisible();
    await shot(page, 'onboarding-4-niveaux', true);
    await page.getByRole('button', { name: 'C’est parti' }).scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 4000);
    await shot(page, 'onboarding-4-niveaux-bas');

    await page.goto('/app/deconnexion');
    await expect(page).toHaveURL(/\/app\/connexion$/);
    await page.goto('/app/connexion/code');
    await shot(page, 'connexion-code');
    await page.goto('/app/mot-de-passe-oublie');
    await shot(page, 'mot-de-passe-oublie');
    await page.getByLabel('Adresse email').fill('ines@exemple.fr');
    await page.getByRole('button', { name: 'Recevoir le lien' }).click();
    await expect(page.getByTestId('recover-sent')).toBeVisible();
    await shot(page, 'mot-de-passe-oublie-envoye');
    const rec = supabase.fake.lastEmail('ines@exemple.fr', 'recovery')!;
    await page.goto(`/app/auth/confirmer?token_hash=${rec.tokenHash}&type=recovery`);
    await page.getByLabel('Nouveau mot de passe').fill('Nouveau-Secret');
    await shot(page, 'nouveau-mot-de-passe');
    await page.goto('/app/deconnexion');
    await expect(page).toHaveURL(/\/app\/connexion$/);
    await page.goto('/app/auth/confirmer?token_hash=jeton-expire-123&type=email');
    await expect(page.getByRole('heading', { level: 1, name: 'Lien invalide' })).toBeVisible();
    await shot(page, 'lien-invalide');
  });

  test('écrans connectés', async ({ page, supabase, isMobile }) => {
    const p = isMobile ? '' : 'desktop-';
    await login(page, supabase.fake, { email: 'ines@exemple.fr', password: PASSWORD, firstName: 'Inès', onboarded: true });
    await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await shot(page, `${p}accueil`);
    if (isMobile) await shot(page, 'accueil-complet', true);

    for (const [tab, name] of [['Prospects', 'prospects'], ['Deals', 'deals'], ['Gains', 'gains']] as const) {
      await page.getByRole('link', { name: tab }).click();
      await expect(page.getByRole('heading', { level: 1, name: tab })).toBeVisible();
      await shot(page, `${p}${name}`, isMobile);
    }
    await page.getByRole('link', { name: 'Profil' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible();
    await shot(page, `${p}profil`, isMobile);
    if (!isMobile) return;
    await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, 'profil-suppression');
  });

  test('accueil d’un stacker Pro et compte supprimé', async ({ page, supabase, isMobile }) => {
    test.skip(!isMobile, 'mobile uniquement');
    await login(page, supabase.fake, {
      email: 'paul@exemple.fr',
      password: PASSWORD,
      firstName: 'Paul',
      onboarded: true,
      activeClients: 6,
      profile: { launch_priority: true, xp: 1240, last_name: 'Roche', phone: '+33612345678' },
    });
    await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Paul' })).toBeVisible();
    await shot(page, 'accueil-pro-liste-attente');
    await page.goto('/app/profil');
    await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Tape SUPPRIMER pour confirmer').fill('SUPPRIMER');
    await dialog.getByLabel('Ton mot de passe').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ton compte a été supprimé' })).toBeVisible();
    await shot(page, 'compte-supprime');
  });
});
