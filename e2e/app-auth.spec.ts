/**
 * Lot 2 : parcours d'authentification de l'app connectée (Supabase Auth
 * simulé par e2e/fake-supabase.ts, mêmes règles serveur que la base).
 */
import type { Page } from '@playwright/test';
import { UNCONFIGURED, expect, expectAccessible, expectNoHorizontalOverflow, test } from './fixtures';

const PASSWORD = 'Plombier-Avignon-2026';

async function fillSignup(page: Page, opts: { email: string; firstName?: string; password?: string; birthDate?: string }) {
  const form = page.getByRole('form', { name: 'Création de compte' });
  await form.getByLabel('Prénom').fill(opts.firstName ?? 'Inès');
  await form.getByLabel('Adresse email').fill(opts.email);
  await form.getByLabel('Mot de passe', { exact: true }).fill(opts.password ?? PASSWORD);
  await form.getByLabel('Date de naissance').fill(opts.birthDate ?? '1995-04-12');
  await form.getByLabel(/Je certifie être majeur/).check();
  await form.getByLabel(/J’accepte les conditions d’utilisation/).check();
  return form;
}

async function completeOnboarding(page: Page, opts: { firstName?: string } = {}) {
  await expect(page).toHaveURL(/\/app\/bienvenue$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Comment veux-tu qu’on t’appelle ?' })).toBeVisible();
  if (opts.firstName !== undefined) await page.getByLabel('Prénom').fill(opts.firstName);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Où vas-tu prospecter ?' })).toBeFocused();
  await page.getByLabel('Département').selectOption('84');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Quel est ton objectif ?' })).toBeFocused();
  await page.getByText('Un complément de revenu').click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Tes niveaux et tes commissions' })).toBeVisible();
  await page.getByRole('button', { name: 'C’est parti' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test.describe('accès protégé', () => {
  test('sans session, /app ouvre l’écran d’accueil (créer un compte / se connecter)', async ({ page, supabase }) => {
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app\/demarrer$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Stack tes clients.' })).toBeVisible();
    await expectAccessible(page, 'accueil avant connexion');
    await expectNoHorizontalOverflow(page, 'accueil avant connexion');
    expect(supabase.fake.calls.filter((c) => c.path.startsWith('/rest/v1/'))).toEqual([]);
    await page.getByRole('link', { name: 'J’ai déjà un compte' }).click();
    await expect(page).toHaveURL(/\/app\/connexion$/);
    await page.goBack();
    await page.getByRole('link', { name: 'Créer mon compte' }).click();
    await expect(page).toHaveURL(/\/app\/inscription$/);
  });

  for (const path of ['/app/prospects', '/app/deals', '/app/gains', '/app/profil', '/app/bienvenue']) {
    test(`sans session, ${path} redirige vers la connexion`, async ({ page, supabase }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/app\/connexion$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Content de te revoir' })).toBeVisible();
      // Aucune donnée demandée sans session.
      expect(supabase.fake.calls.filter((c) => c.path.startsWith('/rest/v1/'))).toEqual([]);
    });
  }

  test('URL inconnue sous /app : retour à l’accueil (donc à l’écran d’accueil)', async ({ page }) => {
    await page.goto('/app/nimporte-quoi');
    await expect(page).toHaveURL(/\/app\/demarrer$/);
  });

  test('en-têtes de l’app : CSP stricte, non indexée', async ({ request }) => {
    const res = await request.get('/app/connexion');
    expect(res.status()).toBe(200);
    const csp = res.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com;");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(res.headers()['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers()['x-frame-options']).toBe('DENY');
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /app');
  });

  test('site sans Supabase : l’espace stacker est fermé proprement', async ({ page }) => {
    await page.goto(`${UNCONFIGURED}/app/inscription`);
    await expect(page.getByRole('heading', { level: 1, name: 'Bientôt disponible' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Rejoindre la liste d’attente' })).toHaveAttribute('href', '/liste-attente');
  });
});

test.describe('inscription', () => {
  test('inscription → confirmation par lien → onboarding → accueil', async ({ page, supabase }) => {
    const { fake } = supabase;
    await page.goto('/app/inscription');
    await expect(page.getByRole('heading', { level: 1, name: 'Crée ton compte' })).toBeVisible();
    await expectAccessible(page, 'inscription');
    await expectNoHorizontalOverflow(page, 'inscription');

    const form = await fillSignup(page, { email: ' Ines@Exemple.fr ' });
    await expect(form.getByRole('list', { name: 'Règles du mot de passe' }).locator('li.is-ok')).toHaveCount(4);
    await form.getByRole('button', { name: 'Créer mon compte' }).click();

    await expect(page).toHaveURL(/\/app\/verifier-email$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Vérifie ta boîte mail' })).toBeVisible();
    await expect(page.getByText('ines@exemple.fr')).toBeVisible();
    await expectAccessible(page, 'vérifier email');

    // Ce que le navigateur a envoyé : majorité déclarée et CGU versionnées, JAMAIS la date de naissance.
    const signup = fake.calls.find((c) => c.path.startsWith('/auth/v1/signup'))!;
    expect(signup.path).toContain(`redirect_to=${encodeURIComponent('http://localhost:4174/app/auth/confirmer')}`);
    expect(signup.body).toMatchObject({
      email: 'ines@exemple.fr',
      password: PASSWORD,
      data: { first_name: 'Inès', adult_declared: true, terms_version: '2026-10-05', marketing_opt_in: false },
    });
    expect(JSON.stringify(signup.body)).not.toContain('1995');
    expect(signup.headers['apikey']).toBe('sb_publishable_e2e_test_key');

    // « Ouverture » de l'email de confirmation.
    const mail = fake.lastEmail('ines@exemple.fr', 'signup')!;
    await page.goto(`/app/auth/confirmer?token_hash=${mail.tokenHash}&type=email`);
    await expect(page).toHaveURL(/\/app\/bienvenue$/);
    await expectAccessible(page, 'onboarding étape 1');
    await expectNoHorizontalOverflow(page, 'onboarding');

    // Étape 1 : prénom prérempli ; un prénom vide est refusé.
    await expect(page.getByLabel('Prénom')).toHaveValue('Inès');
    await page.getByLabel('Prénom').fill('');
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByText('Indique ton prénom.')).toBeVisible();
    await expect(page.getByLabel('Prénom')).toBeFocused();
    await page.getByLabel('Prénom').fill('Inès');
    await page.getByRole('button', { name: 'Continuer' }).click();
    // Étape 2 : département obligatoire.
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByText('Choisis ton département.')).toBeVisible();
    await page.getByLabel('Département').selectOption('84');
    await page.getByRole('button', { name: 'Continuer' }).click();
    // Étape 3 : objectif obligatoire.
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByText('Choisis un objectif.')).toBeVisible();
    await page.getByText('Découvrir d’abord').click();
    await page.getByRole('button', { name: 'Continuer' }).click();
    // Étape 4 : niveaux lus en base, règle de disponibilité, aucune promesse.
    const step4 = page.locator('main');
    await expect(step4.getByText('Rookie')).toBeVisible();
    await expect(step4.getByText('25 clients actifs et plus')).toBeVisible();
    await expect(step4.getByText(/Seuils provisoires/)).toBeVisible();
    await expect(step4.getByText('Versement hebdomadaire')).toBeVisible();
    await expect(step4).toContainText('Aucun montant de gain n’est promis');
    await expect(step4).not.toContainText(/immédiat|instantané|garanti/i);
    await expectAccessible(page, 'onboarding étape 4');
    await page.getByRole('button', { name: 'C’est parti' }).click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();
    const rpc = fake.calls.find((c) => c.path === '/rest/v1/rpc/complete_onboarding')!;
    expect(rpc.body).toEqual({ p_first_name: 'Inès', p_department: '84', p_goal: 'decouvrir' });
    expect(fake.profiles.get([...fake.users.values()][0]!.id)!.onboarding_completed_at).not.toBeNull();
  });

  test('confirmation par code à 6 chiffres + priorité de liste d’attente conservée', async ({ page, supabase }) => {
    const { fake } = supabase;
    fake.waitlist.set('karim@exemple.fr', { firstName: 'Karim', department: '13', createdAt: '2026-10-06T10:00:00Z' });
    await page.goto('/app/inscription');
    const form = await fillSignup(page, { email: 'karim@exemple.fr', firstName: 'Karim' });
    await form.getByLabel(/Facultatif/).check();
    await form.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(page).toHaveURL(/\/app\/verifier-email$/);

    // Mauvais code : message sous le champ.
    await page.getByLabel('Code de confirmation').fill('000000');
    await page.getByRole('button', { name: 'Confirmer mon adresse' }).click();
    await expect(page.getByText('Code incorrect ou expiré.', { exact: false })).toBeVisible();

    const code = fake.lastEmail('karim@exemple.fr', 'signup')!.code;
    await page.getByLabel('Code de confirmation').fill(`${code.slice(0, 3)} ${code.slice(3)}`);
    await page.getByRole('button', { name: 'Confirmer mon adresse' }).click();
    await completeOnboarding(page);

    await expect(page.getByText('Priorité de lancement conservée (liste d’attente)')).toBeVisible();
    const signup = fake.calls.find((c) => c.path.startsWith('/auth/v1/signup'))!;
    expect(signup.body).toMatchObject({ data: { marketing_opt_in: true } });
  });

  test('validation dans le navigateur : erreurs lisibles, mineur refusé, aucun envoi', async ({ page, supabase }) => {
    await page.goto('/app/inscription');
    const form = page.getByRole('form', { name: 'Création de compte' });
    await form.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(form.getByText('Indique ton prénom.')).toBeVisible();
    await expect(form.getByText('Adresse email invalide.')).toBeVisible();
    await expect(form.getByText('Ton mot de passe doit respecter les 4 règles.')).toBeVisible();
    await expect(form.getByText('Indique ta date de naissance.')).toBeVisible();
    await expect(form.getByText('Coche cette case pour continuer.')).toBeVisible();
    await expect(form.getByLabel('Prénom')).toBeFocused();

    await fillSignup(page, { email: 'mineur@exemple.fr', birthDate: '2010-06-01' });
    await form.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(form.getByText('Stacker est réservé aux personnes majeures.')).toBeVisible();
    await expect(form.getByLabel('Date de naissance')).toBeFocused();

    await form.getByLabel('Date de naissance').fill('1990-01-01');
    await form.getByLabel('Mot de passe', { exact: true }).fill('mineur.exemple2026A');
    await form.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(form.getByText('Ton mot de passe ne doit pas contenir ton adresse email.')).toBeVisible();

    expect(supabase.fake.calls.filter((c) => c.path.startsWith('/auth/v1/signup'))).toEqual([]);
    await expectAccessible(page, 'inscription en erreur');
  });

  test('adresse déjà inscrite : même écran, aucune information divulguée, aucun email', async ({ page, supabase }) => {
    const { fake } = supabase;
    fake.seedUser({ email: 'deja@exemple.fr', password: PASSWORD, onboarded: true });
    await page.goto('/app/inscription');
    const form = await fillSignup(page, { email: 'deja@exemple.fr', password: 'Autre-MotDePasse-99' });
    await form.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(page).toHaveURL(/\/app\/verifier-email$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Vérifie ta boîte mail' })).toBeVisible();
    expect(fake.outbox).toEqual([]);
  });

  test('mot de passe ayant fuité (refus serveur) : message sous le champ', async ({ page }) => {
    await page.goto('/app/inscription');
    const form = await fillSignup(page, { email: 'fuite@exemple.fr', password: 'Azerty123456' });
    await form.getByRole('button', { name: 'Créer mon compte' }).click();
    await expect(form.getByText('Ce mot de passe apparaît dans des fuites de données connues. Choisis-en un autre.')).toBeVisible();
    await expect(page).toHaveURL(/\/app\/inscription$/);
  });

  test('renvoi de l’email de confirmation : message neutre et délai', async ({ page, supabase }) => {
    await page.goto('/app/inscription');
    const form = await fillSignup(page, { email: 'renvoi@exemple.fr' });
    await form.getByRole('button', { name: 'Créer mon compte' }).click();
    await page.getByRole('button', { name: 'Renvoyer l’email' }).click();
    await expect(page.getByText('Si cette adresse attend une confirmation, un nouvel email vient de partir.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Renvoyer l’email \(\d+ s\)/ })).toBeDisabled();
    expect(supabase.fake.outbox.filter((e) => e.to === 'renvoi@exemple.fr')).toHaveLength(2);
  });

  test('lien de confirmation invalide ou déjà utilisé : message clair, jeton retiré de l’URL', async ({ page }) => {
    await page.goto('/app/auth/confirmer?token_hash=pas-un-vrai-jeton-123&type=email');
    await expect(page.getByRole('heading', { level: 1, name: 'Lien invalide' })).toBeVisible();
    await expect(page.getByText('Ce lien a expiré ou a déjà servi. Demande-en un nouveau.')).toBeVisible();
    expect(page.url()).not.toContain('token_hash');
    await page.goto('/app/auth/confirmer?type=email');
    await expect(page.getByText('Ce lien est incomplet.', { exact: false })).toBeVisible();
    await expectAccessible(page, 'lien invalide');
  });
});

test.describe('connexion', () => {
  test('connexion par mot de passe, redirection vers la page demandée', async ({ page, supabase }) => {
    supabase.fake.seedUser({ email: 'lea@exemple.fr', password: PASSWORD, firstName: 'Léa', onboarded: true });
    await page.goto('/app/profil');
    await expect(page).toHaveURL(/\/app\/connexion$/);
    await expectAccessible(page, 'connexion');
    await expectNoHorizontalOverflow(page, 'connexion');
    await page.getByLabel('Adresse email').fill('lea@exemple.fr');
    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/app\/profil$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible();
  });

  test('identifiants faux ou compte inconnu : le même message', async ({ page, supabase }) => {
    supabase.fake.seedUser({ email: 'lea@exemple.fr', password: PASSWORD, onboarded: true });
    await page.goto('/app/connexion');
    await page.getByLabel('Adresse email').fill('lea@exemple.fr');
    await page.getByLabel('Mot de passe', { exact: true }).fill('Mauvais-Mot2Passe');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText('Email ou mot de passe incorrect.');
    await page.getByLabel('Adresse email').fill('inconnu@exemple.fr');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(alert).toHaveText('Email ou mot de passe incorrect.');
    await expect(page).toHaveURL(/\/app\/connexion$/);
  });

  test('« Rester connecté » décoché : session dans l’onglet seulement, conservée au rechargement', async ({ page, supabase }) => {
    supabase.fake.seedUser({ email: 'tab@exemple.fr', password: PASSWORD, firstName: 'Tom', onboarded: true });
    await page.goto('/app/connexion');
    await page.getByLabel('Adresse email').fill('tab@exemple.fr');
    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Rester connecté sur cet appareil').uncheck();
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Tom' })).toBeVisible();
    const where = await page.evaluate(() => ({ local: window.localStorage.getItem('stacker-auth'), tab: window.sessionStorage.getItem('stacker-auth') }));
    expect(where.local).toBeNull();
    expect(where.tab).toContain('access_token');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Tom' })).toBeVisible();
    // Aucune donnée métier dans le stockage du navigateur.
    const keys = await page.evaluate(() => [...Object.keys(window.localStorage), ...Object.keys(window.sessionStorage)]);
    expect(keys).toEqual(['stacker-auth']);
  });

  test('connexion par code reçu par email ; adresse inconnue : même réponse neutre', async ({ page, supabase }) => {
    const { fake } = supabase;
    fake.seedUser({ email: 'code@exemple.fr', password: PASSWORD, firstName: 'Chloé', onboarded: true });
    await page.goto('/app/connexion');
    await page.getByRole('link', { name: 'Recevoir un code par email' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Connexion par code' })).toBeVisible();

    await page.getByLabel('Adresse email').fill('personne@exemple.fr');
    await page.getByRole('button', { name: 'Recevoir un code' }).click();
    await expect(page.getByText('Si un compte existe pour personne@exemple.fr, un code vient de partir.', { exact: false })).toBeVisible();
    expect(fake.outbox).toEqual([]);
    expect(fake.calls.find((c) => c.path === '/auth/v1/otp')!.body).toMatchObject({ create_user: false });

    await page.goto('/app/connexion/code');
    await page.getByLabel('Adresse email').fill('code@exemple.fr');
    await page.getByRole('button', { name: 'Recevoir un code' }).click();
    // Attendre la réponse du serveur avant de lire la boîte d'envoi (test instable sinon).
    await expect(page.getByText('Si un compte existe pour code@exemple.fr, un code vient de partir.', { exact: false })).toBeVisible();
    await page.getByLabel('Code reçu par email').fill(fake.lastEmail('code@exemple.fr', 'magiclink')!.code);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Chloé' })).toBeVisible();
  });
});

test.describe('mot de passe oublié', () => {
  test('demande neutre, lien de récupération, nouveau mot de passe, reconnexion', async ({ page, supabase }) => {
    const { fake } = supabase;
    fake.seedUser({ email: 'oubli@exemple.fr', password: PASSWORD, firstName: 'Omar', onboarded: true });
    await page.goto('/app/connexion');
    await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mot de passe oublié' })).toBeVisible();
    await expectAccessible(page, 'mot de passe oublié');

    // Adresse inconnue : exactement la même confirmation.
    await page.getByLabel('Adresse email').fill('inconnu@exemple.fr');
    await page.getByRole('button', { name: 'Recevoir le lien' }).click();
    const neutral = 'Si un compte existe pour cette adresse, un email vient de partir';
    await expect(page.getByTestId('recover-sent')).toContainText(neutral);
    expect(fake.outbox).toEqual([]);

    await page.goto('/app/mot-de-passe-oublie');
    await page.getByLabel('Adresse email').fill('oubli@exemple.fr');
    await page.getByRole('button', { name: 'Recevoir le lien' }).click();
    await expect(page.getByTestId('recover-sent')).toContainText(neutral);

    const mail = fake.lastEmail('oubli@exemple.fr', 'recovery')!;
    await page.goto(`/app/auth/confirmer?token_hash=${mail.tokenHash}&type=recovery`);
    await expect(page).toHaveURL(/\/app\/nouveau-mot-de-passe$/);
    await expectAccessible(page, 'nouveau mot de passe');

    const NEW = 'Nouveau-Secret-2027';
    await page.getByLabel('Nouveau mot de passe').fill(NEW);
    await page.getByLabel('Confirme le mot de passe').fill('Nouveau-Secret-2028');
    await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
    await expect(page.getByText('Les deux mots de passe sont différents.')).toBeVisible();

    await page.getByLabel('Nouveau mot de passe').fill(PASSWORD);
    await page.getByLabel('Confirme le mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
    await expect(page.getByText('Choisis un mot de passe différent de l’ancien.')).toBeVisible();

    await page.getByLabel('Nouveau mot de passe').fill(NEW);
    await page.getByLabel('Confirme le mot de passe').fill(NEW);
    await page.getByRole('button', { name: 'Enregistrer le mot de passe' }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('status').filter({ hasText: 'Ton mot de passe a été mis à jour.' })).toBeVisible();

    // Le lien ne sert qu'une fois.
    await page.goto('/app/deconnexion');
    await expect(page).toHaveURL(/\/app\/connexion$/);
    await page.goto(`/app/auth/confirmer?token_hash=${mail.tokenHash}&type=recovery`);
    await expect(page.getByRole('heading', { level: 1, name: 'Lien invalide' })).toBeVisible();

    await page.goto('/app/connexion');
    await page.getByLabel('Adresse email').fill('oubli@exemple.fr');
    await page.getByLabel('Mot de passe', { exact: true }).fill(NEW);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Omar' })).toBeVisible();
  });

  test('page « nouveau mot de passe » sans lien valide : invitation à recommencer', async ({ page }) => {
    await page.goto('/app/nouveau-mot-de-passe');
    await expect(page.getByRole('heading', { level: 1, name: 'Lien expiré' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Demander un nouveau lien' })).toHaveAttribute('href', '/app/mot-de-passe-oublie');
  });
});
