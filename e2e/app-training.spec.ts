/**
 * Lot 10 : entraînement à l'appel face à une IA. Choix du commerçant, appel
 * (à l'écrit ici : le navigateur de test n'a pas de micro), bilan noté,
 * réussite, relecture d'un ancien appel, et signature bloquée tant que
 * l'entraînement exigé n'est pas réussi.
 */
import type { Page } from '@playwright/test';
import type { FakeSupabase } from './fake-supabase';
import { expect, expectAccessible, expectNoHorizontalOverflow, test } from './fixtures';

const PASSWORD = 'Plombier-Avignon-2026';

async function login(page: Page, fake: FakeSupabase) {
  const user = fake.seedUser({ email: 'ines@exemple.fr', password: PASSWORD, firstName: 'Inès', onboarded: true, profile: { last_name: 'Martin', phone: '+33611223344', department: '30' } });
  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill('ines@exemple.fr');
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();
  return user;
}

async function say(page: Page, text: string, reply: string) {
  const input = page.getByLabel('Écrire ta phrase');
  await expect(input).toBeEnabled();
  await input.fill(text);
  await page.getByRole('button', { name: 'Envoyer' }).click();
  await expect(page.getByRole('log', { name: 'Conversation' }).getByText(reply)).toBeVisible();
}

test.describe('entraînement', () => {
  test('appel complet, bilan réussi, relecture, accès depuis l’accueil et la formation', async ({ page, supabase }) => {
    test.slow();
    supabase.fake.admin.flags['roleplay_required'] = true;
    const user = await login(page, supabase.fake);

    // Accueil : mission « Réussir un appel d'entraînement », obligatoire.
    const mission = page.getByRole('link', { name: /Réussir un appel d’entraînement/ });
    await expect(mission).toContainText('Obligatoire avant ta première signature');
    await mission.click();

    await expect(page.getByRole('heading', { level: 1, name: 'Entraînement' })).toBeVisible();
    await expect(page.getByText('Obligatoire avant ta première signature')).toBeVisible();
    await expect(page.getByText(/Réussite à partir de 70\/100, avec au moins 5 répliques · 8 simulations restantes/)).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Boulangerie Martin' })).toContainText('Aucune photo du magasin sur la fiche.');
    // Accord avant le premier appel : ce qui est dit part chez le prestataire d'IA.
    const consent = page.getByRole('region', { name: 'Avant ton premier appel' });
    await expect(consent).toContainText('Anthropic');
    await expect(page.getByRole('button', { name: 'Appeler Sophie' })).toBeDisabled();
    await expectAccessible(page, 'entraînement');
    await expectNoHorizontalOverflow(page, 'entraînement');
    if (process.env['DEMO']) await page.evaluate(() => window.scrollTo(0, 0)).then(() => page.waitForTimeout(900));
    if (process.env['DEMO']) await page.screenshot({ path: `qa/entrainement-choix-${test.info().project.name}.png` });

    await consent.getByRole('button', { name: 'J’accepte et je m’entraîne' }).click();
    await expect(consent).toHaveCount(0);

    // Un premier appel trop court : pas réussi.
    await page.getByRole('button', { name: 'Appeler Sophie' }).click();
    if (process.env['DEMO']) {
      await page.waitForTimeout(700);
      await page.screenshot({ path: `qa/entrainement-sonnerie-${test.info().project.name}.png` });
    }
    await expect(page.getByRole('log', { name: 'Conversation' }).getByText('Boulangerie Martin, bonjour !')).toBeVisible();
    await say(page, 'Bonjour, Inès Martin, apporteuse d’affaires indépendante pour Stacker.', 'Oui, c’est pour quoi ?');
    await page.getByRole('button', { name: 'Raccrocher et voir mon bilan' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ton bilan' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '45/100' })).toBeVisible();
    await expect(page.getByText('Pas encore')).toBeVisible();
    await expect(page.getByText('Il faut 70/100 pour valider.', { exact: false })).toBeVisible();

    // Rappel : un vrai appel, réussi.
    await page.getByRole('button', { name: 'Rappeler Sophie' }).click();
    await say(page, 'Bonjour, Inès Martin, apporteuse d’affaires indépendante pour Stacker.', 'Oui, c’est pour quoi ?');
    await say(page, 'J’ai vu que votre fiche Google indique 19 h le dimanche.', 'Ah bon, la fiche Google ?');
    await say(page, 'On tient votre fiche à jour chaque mois, pour 69 € par mois.', 'Ça coûte combien ?');
    await say(page, '69 € par mois, sans engagement.', 'C’est avec engagement ?');
    await say(page, 'Non. Je passe jeudi à 10 h pour vous montrer ?', 'D’accord, passez jeudi à 10 h.');
    await expect(page.getByRole('status').filter({ hasText: 'À toi de parler' })).toBeVisible();
    await expectNoHorizontalOverflow(page, 'appel');
    if (process.env['DEMO']) await page.screenshot({ path: `qa/entrainement-appel-${test.info().project.name}.png` });
    await page.getByRole('button', { name: 'Raccrocher et voir mon bilan' }).click();

    await expect(page.getByRole('heading', { name: '80/100' })).toBeVisible();
    await expect(page.getByText('Réussi', { exact: true })).toBeVisible();
    await expect(page.getByText('Boulangerie Martin · Rendez-vous obtenu')).toBeVisible();
    await expect(page.getByText('Présentation de l’offre')).toBeVisible();
    await expect(page.getByText('« Si je comprends bien, des clients viennent pour rien le dimanche ? »')).toBeVisible();
    await expectAccessible(page, 'bilan');
    if (process.env['DEMO']) {
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `qa/entrainement-bilan-${test.info().project.name}.png` });
      await page.getByRole('heading', { name: 'Le détail' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `qa/entrainement-bilan-ecran-${test.info().project.name}.png` });
    }
    expect(supabase.fake.roleplay.passed(user.id)).toBe(true);

    // Historique et relecture.
    await page.getByRole('button', { name: 'Choisir un autre commerçant' }).click();
    await expect(page.getByText('Entraînement réussi')).toBeVisible();
    await page.getByRole('button', { name: /Boulangerie Martin.*80\/100/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Appel d’entraînement' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'La conversation' })).toBeVisible();
    await expect(page.getByText('Je passe jeudi à 10 h pour vous montrer ?', { exact: false })).toBeVisible();

    // Accès depuis la formation.
    await page.goto('/app/formation');
    await page.getByRole('link', { name: /Entraîne-toi à voix haute/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Entraînement' })).toBeVisible();
  });

  test('signature bloquée tant que l’entraînement exigé n’est pas réussi', async ({ page, supabase }) => {
    supabase.fake.admin.flags['roleplay_required'] = true;
    await login(page, supabase.fake);
    await page.goto('/app/deals/nouveau');
    const banner = page.getByRole('status').filter({ hasText: 'Réussis une simulation d’appel avant ta première signature.' });
    await expect(banner).toBeVisible();
    await banner.getByRole('link', { name: 'S’entraîner' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Entraînement' })).toBeVisible();
  });

  test('interrupteur coupé : aucun blocage ; quota du jour atteint : appels désactivés', async ({ page, supabase }) => {
    supabase.fake.roleplay.dailyLimit = 0;
    await login(page, supabase.fake);
    await expect(page.getByRole('link', { name: /Réussir un appel d’entraînement/ })).toContainText('Face à un commerçant joué par une IA');
    await page.goto('/app/deals/nouveau');
    await expect(page.getByText('Réussis une simulation d’appel avant ta première signature.')).toHaveCount(0);
    await page.goto('/app/entrainement');
    await expect(page.getByText(/0 simulations restantes aujourd’hui/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Appeler Sophie' })).toBeDisabled();
  });

  test('Academy : onglet, statistiques, accès à l’entraînement, « passe aux vrais appels » une fois prêt', async ({ page, supabase }) => {
    const user = await login(page, supabase.fake);
    const nav = page.getByRole('navigation', { name: 'Navigation de l’application' });
    await nav.getByRole('link', { name: 'Academy' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Stacker Academy/ })).toBeVisible();
    await expect(page.locator('.academy-stats')).toContainText('Appels0');
    await expect(page.getByRole('link', { name: /Tu es prêt : passe aux vrais appels/ })).toHaveCount(0);
    await expectAccessible(page, 'academy');
    await expectNoHorizontalOverflow(page, 'academy');

    await page.getByRole('link', { name: /Appel d’entraînement/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Entraînement' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Academy' })).toHaveClass(/is-active/);

    // Un appel réussi (simulé) : l'Academy propose de passer au vrai.
    supabase.fake.roleplay.consents.add(user.id);
    supabase.fake.roleplay.sessions.push({ id: '00000000-0000-4000-8000-0000000004a1', stacker: user.id, scenario: 'boulangerie', status: 'terminee', turns: [], score: 82, passed: true, feedback: null, started_at: new Date().toISOString() });
    await page.goto('/app/academy');
    await expect(page.locator('.academy-stats')).toContainText('82/100');
    await page.getByRole('link', { name: /Tu es prêt : passe aux vrais appels/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Prospects' })).toBeVisible();
  });
});
