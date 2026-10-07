/**
 * Lot 2 : coquille de l'app connectée (accueil réel, onglets, profil,
 * export RGPD, suppression du compte, déconnexion).
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { FakeSupabase } from './fake-supabase';
import { expect, expectAccessible, expectNoHorizontalOverflow, test } from './fixtures';

const PASSWORD = 'Plombier-Avignon-2026';

async function login(page: Page, fake: FakeSupabase, opts: Parameters<FakeSupabase['seedUser']>[0] = { email: 'ines@exemple.fr', password: PASSWORD, firstName: 'Inès', onboarded: true }) {
  const user = fake.seedUser(opts);
  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill(opts.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(opts.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation de l’application' })).toBeVisible();
  return user;
}

test.describe('accueil', () => {
  test('données réelles du profil, état vide propre, aucune fausse donnée', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    const main = page.locator('main');
    await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();
    // Date du jour calculée (jamais figée), en heure de Paris.
    const today = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(new Date()).toUpperCase();
    await expect(main.getByText(today, { exact: true })).toBeVisible();
    // Niveau calculé côté serveur + progression vers le suivant (seuils provisoires signalés).
    await expect(main.getByText('Rookie')).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Encore 3 clients actifs avant Pro' })).toBeVisible();
    await expect(main.getByRole('progressbar', { name: 'Progression vers le niveau Pro' })).toHaveAttribute('aria-valuenow', '0');
    await expect(main.getByText(/Seuils provisoires/)).toBeVisible();
    // Commissions : état vide honnête, pas de solde inventé ni de bouton « Virer ».
    await expect(main.getByText('Aucune pour l’instant')).toBeVisible();
    await expect(main).not.toContainText(/€|Virer|Solde|immédiat|bonus/i);
    await expect(main.getByText('0 XP')).toBeVisible();
    await expect(main.getByText('0 client', { exact: true })).toBeVisible();
    await expect(main.getByText('3 à faire')).toBeVisible();
    await expectAccessible(page, 'accueil');
    await expectNoHorizontalOverflow(page, 'accueil');
  });

  test('progression réelle d’un stacker Pro (6 clients actifs)', async ({ page, supabase }) => {
    await login(page, supabase.fake, { email: 'pro@exemple.fr', password: PASSWORD, firstName: 'Paul', onboarded: true, activeClients: 6 });
    const main = page.locator('main');
    await expect(main.locator('.home-level .level-pro')).toContainText('Pro');
    await expect(main.getByRole('heading', { name: 'Encore 4 clients actifs avant Legend' })).toBeVisible();
    await expect(main.getByText('3 / 7 clients actifs')).toBeVisible();
    await expect(main.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '43');
  });

  test('compte non onboardé : redirigé vers l’onboarding, puis l’accueil', async ({ page, supabase }) => {
    await login(page, supabase.fake, { email: 'neuf@exemple.fr', password: PASSWORD, firstName: 'Nina' }).catch(() => undefined);
    await expect(page).toHaveURL(/\/app\/bienvenue$/);
    await page.goto('/app/profil');
    await expect(page).toHaveURL(/\/app\/bienvenue$/);
  });
});

test.describe('navigation', () => {
  test('barre basse : 5 onglets, onglet courant signalé, écrans « bientôt disponible » sans faux chiffres', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    const nav = page.getByRole('navigation', { name: 'Navigation de l’application' });
    await expect(nav.getByRole('link')).toHaveText(['Accueil', 'Prospects', 'Deals', 'Gains', 'Profil']);
    await expect(nav.getByRole('link', { name: 'Accueil' })).toHaveAttribute('aria-current', 'page');

    await nav.getByRole('link', { name: 'Prospects' }).click();
    await expect(page).toHaveURL(/\/app\/prospects$/);
    await expect(nav.getByRole('link', { name: 'Prospects' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1, name: 'Prospects' })).toBeFocused();
    await expect(page.locator('main')).toContainText('ta zone (Vaucluse)');
    await expect(page.locator('main')).not.toContainText(/\d+ entreprises/);
    await expectAccessible(page, 'prospects');
    await expectNoHorizontalOverflow(page, 'prospects');

    await nav.getByRole('link', { name: 'Deals' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Deals' })).toBeVisible();
    await expect(page.locator('main')).toContainText('signe lui-même, sur son propre téléphone');
    await expectAccessible(page, 'deals');

    await nav.getByRole('link', { name: 'Gains' }).click();
    const main = page.locator('main');
    await expect(page.getByRole('heading', { level: 1, name: 'Gains' })).toBeVisible();
    await expect(main.getByText('Aucun prévu')).toBeVisible();
    await expect(main).not.toContainText(/\d+,\d{2}\s?€|Virer|Solde|sous 24 h|immédiat/i);
    await expect(main.locator('.tier-rows li')).toHaveCount(4);
    await expect(main.locator('.tier-rows li.is-current')).toContainText('Ton niveau');
    await expect(main).toContainText('Versement hebdomadaire');
    await expectAccessible(page, 'gains');
    await expectNoHorizontalOverflow(page, 'gains');

    await nav.getByRole('link', { name: 'Profil' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible();
  });

  test('clavier : les onglets se parcourent et s’activent sans souris', async ({ page, supabase, isMobile }) => {
    test.skip(isMobile, 'clavier physique : desktop');
    await login(page, supabase.fake);
    // L'accueil (chargé à la demande) place le focus sur son titre en arrivant : on l'attend,
    // sinon il vole le focus posé sur l'onglet (test instable : 1 échec sur 3 passages).
    await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeFocused();
    const gains = page.getByRole('link', { name: 'Gains' });
    await gains.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app\/gains$/);
  });
});

test.describe('profil', () => {
  test('édition des champs autorisés, validation, enregistrement réel', async ({ page, supabase }) => {
    const user = await login(page, supabase.fake);
    await page.goto('/app/profil');
    await expect(page.getByText('ines@exemple.fr')).toBeVisible();
    await expectAccessible(page, 'profil');
    await expectNoHorizontalOverflow(page, 'profil');

    const form = page.getByRole('form', { name: 'Mes informations' });
    await form.getByRole('textbox', { name: 'Nom (facultatif)' }).fill('Martin');
    await form.getByLabel('Téléphone').fill('06 12');
    await form.getByLabel('Ville').fill('Villeneuve-lès-Avignon');
    await form.getByLabel('Statut juridique déclaré').selectOption('micro_entrepreneur');
    await form.getByLabel('SIRET').fill('732 829 320 00075');
    await form.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(form.getByText('Numéro invalide (ex. 06 12 34 56 78).')).toBeVisible();
    await expect(form.getByText('SIRET invalide (14 chiffres, vérifie la saisie).')).toBeVisible();
    await expect(form.getByLabel('Téléphone')).toBeFocused();
    expect(supabase.fake.calls.filter((c) => c.method === 'PATCH')).toEqual([]);

    await form.getByLabel('Téléphone').fill('06 12 34 56 78');
    await form.getByLabel('SIRET').fill('732 829 320 00074');
    await form.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(form.getByText('Modifications enregistrées.')).toBeVisible();

    const patch = supabase.fake.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.path).toContain(`id=eq.${user.id}`);
    // Uniquement les colonnes déclaratives : jamais le niveau, l'XP ni les champs serveur.
    expect(Object.keys(patch.body as object).sort()).toEqual(['city', 'department', 'first_name', 'goal', 'last_name', 'legal_status', 'phone', 'siret']);
    expect(patch.body).toMatchObject({ last_name: 'Martin', phone: '+33612345678', siret: '73282932000074', city: 'Villeneuve-lès-Avignon' });

    await page.reload();
    await expect(form.getByLabel('Téléphone')).toHaveValue('06 12 34 56 78');
    await expect(page.getByText('Inès Martin')).toBeVisible();
    await page.getByRole('link', { name: 'Accueil' }).click();
    await expect(page.getByText('3 à faire')).toHaveCount(0);
  });

  test('refus serveur (contrainte) : message clair, pas de faux succès', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    await page.goto('/app/profil');
    const form = page.getByRole('form', { name: 'Mes informations' });
    await expect(form).toBeVisible();
    supabase.fake.failNext.set('PATCH /rest/v1/profiles', { status: 400, body: { code: '23514', message: 'check' } });
    await form.getByLabel('Ville').fill('Avignon');
    await form.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(form.getByRole('alert')).toHaveText('Une valeur n’a pas été acceptée. Vérifie ta saisie.');
    await expect(form.getByText('Modifications enregistrées.')).toHaveCount(0);
  });

  test('export de mes données au format JSON', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    await page.goto('/app/profil');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exporter mes données' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^stacker-mes-donnees-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(readFileSync(await file.path(), 'utf8')) as { format: string; account: { email: string } };
    expect(data.format).toBe('stacker-export-v1');
    expect(data.account.email).toBe('ines@exemple.fr');
  });

  test('suppression du compte : confirmation, réauthentification, effacement serveur', async ({ page, supabase }) => {
    const { fake } = supabase;
    const user = await login(page, fake);
    await page.goto('/app/profil');
    await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
    const dialog = page.getByRole('dialog', { name: 'Supprimer ton compte ?' });
    await expect(dialog).toBeVisible();
    await expectAccessible(page, 'dialogue suppression');

    await dialog.getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(dialog.getByText('Tape SUPPRIMER en majuscules pour confirmer.')).toBeVisible();
    await dialog.getByLabel('Tape SUPPRIMER pour confirmer').fill('SUPPRIMER');
    await dialog.getByLabel('Ton mot de passe').fill('Mauvais-Mot2Passe');
    await dialog.getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(dialog.getByText('Mot de passe incorrect.')).toBeVisible();
    expect(fake.users.has(user.id)).toBe(true);

    // Annuler ferme sans rien supprimer.
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
    await dialog.getByLabel('Tape SUPPRIMER pour confirmer').fill('SUPPRIMER');
    await dialog.getByLabel('Ton mot de passe').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Supprimer définitivement' }).click();

    await expect(page).toHaveURL(/\/app\/compte-supprime$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Ton compte a été supprimé' })).toBeVisible();
    expect(fake.users.has(user.id)).toBe(false);
    expect(fake.profiles.has(user.id)).toBe(false);
    const del = fake.calls.find((c) => c.path === '/functions/v1/account-delete')!;
    expect(del.body).toEqual({ confirm: 'SUPPRIMER' });
    expect(await page.evaluate(() => window.localStorage.getItem('stacker-auth'))).toBeNull();

    // Le compte n'existe plus : la connexion échoue.
    await page.goto('/app/connexion');
    await page.getByLabel('Adresse email').fill('ines@exemple.fr');
    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('alert')).toHaveText('Email ou mot de passe incorrect.');
  });

  test('suppression refusée si la réauthentification date de plus de 10 minutes', async ({ page, supabase }) => {
    const { fake } = supabase;
    const user = await login(page, fake);
    await page.goto('/app/profil');
    fake.failNext.set('/functions/v1/account-delete', { status: 401, body: { ok: false, error: 'reauth_required' } });
    await page.getByRole('button', { name: 'Supprimer mon compte' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Tape SUPPRIMER pour confirmer').fill('SUPPRIMER');
    await dialog.getByLabel('Ton mot de passe').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Supprimer définitivement' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Pour des raisons de sécurité, confirme ton mot de passe.');
    expect(fake.users.has(user.id)).toBe(true);
  });

  test('déconnexion : jetons effacés, retour à la connexion, routes protégées refermées', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    await page.goto('/app/profil');
    await page.getByRole('link', { name: 'Se déconnecter' }).last().click();
    await expect(page).toHaveURL(/\/app\/connexion$/);
    await expect(page.getByText('Tu es déconnecté.')).toBeVisible();
    expect(await page.evaluate(() => [window.localStorage.getItem('stacker-auth'), window.sessionStorage.getItem('stacker-auth')])).toEqual([null, null]);
    expect(supabase.fake.calls.some((c) => c.path.startsWith('/auth/v1/logout'))).toBe(true);
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app\/connexion$/);
  });

  test('session révoquée côté serveur : l’app déconnecte et renvoie vers la connexion', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    // Révocation (ex. « déconnecter tous les appareils », compte bloqué) : le jeton stocké ne vaut plus rien.
    for (const s of supabase.fake.sessions) s.revoked = true;
    await page.reload();
    await expect(page).toHaveURL(/\/app\/connexion$/);
    expect(await page.evaluate(() => window.localStorage.getItem('stacker-auth'))).toBeNull();
    // Aucune donnée du profil n'a été affichée.
    await expect(page.getByText('Bonjour Inès')).toHaveCount(0);
  });
});
