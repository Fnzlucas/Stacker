/**
 * Lot 3 : prospection. Parcours complet (règles → recherche → réservation →
 * coordonnées → appel → email depuis sa messagerie → « Je l'ai envoyé »),
 * exclusivité entre deux stackers, opposition par le lien de l'email,
 * quotas, avertissement « adresse personnelle », « Signé » non cliquable.
 */
import type { Page } from '@playwright/test';
import type { FakeSupabase } from './fake-supabase';
import { expect, expectAccessible, expectNoHorizontalOverflow, test } from './fixtures';

const PASSWORD = 'Plombier-Avignon-2026';

async function login(page: Page, fake: FakeSupabase, email = 'ines@exemple.fr', profile: Record<string, unknown> = { last_name: 'Martin', phone: '+33611223344', department: '30' }) {
  const user = fake.seedUser({ email, password: PASSWORD, firstName: 'Inès', onboarded: true, profile });
  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation de l’application' })).toBeVisible();
  return user;
}

async function openProspects(page: Page, acceptRules = true) {
  await page.getByRole('navigation', { name: 'Navigation de l’application' }).getByRole('link', { name: 'Prospects' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Prospects' })).toBeVisible();
  if (acceptRules) {
    await page.getByRole('button', { name: 'J’ai compris, je m’engage' }).click();
    await expect(page.getByRole('heading', { name: 'Les 4 règles de la prospection' })).toHaveCount(0);
  }
}

async function searchBatiment(page: Page) {
  await page.getByRole('button', { name: 'Artisans du bâtiment' }).click();
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page.getByRole('heading', { name: '12 entreprises' })).toBeVisible();
}

test.describe('prospection', () => {
  test('parcours complet : recherche, réservation, appel, email depuis ma messagerie, statut « contacté »', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    await openProspects(page, false);

    // Règles d'abord : « Réserver » est bloqué tant qu'elles ne sont pas acceptées.
    await expectAccessible(page, 'prospects (règles)');
    await page.getByRole('button', { name: 'Rechercher' }).click();
    await expect(page.getByRole('button', { name: 'Réserver Plomberie Durand 1' })).toBeDisabled();
    await page.getByRole('button', { name: 'J’ai compris, je m’engage' }).click();
    await expect(page.getByRole('button', { name: 'Réserver Plomberie Durand 1' })).toBeEnabled();

    // La zone par défaut est le département du profil.
    const body = supabase.fake.prospects.searchCalls.at(-1) as { zone: { type: string; value: string } };
    expect(body.zone).toEqual({ type: 'departement', value: '30' });
    await searchBatiment(page);
    await expect(page.getByText('/30 recherches aujourd’hui')).toBeVisible();
    await expectAccessible(page, 'prospects (résultats)');
    await expectNoHorizontalOverflow(page, 'prospects (résultats)');

    await page.getByRole('button', { name: 'Réserver Plomberie Durand 1' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Plomberie Durand 1 est réservée pour toi.' })).toBeVisible();
    await page.getByRole('link', { name: 'Ouvrir la fiche de Plomberie Durand 1' }).click();

    // Fiche
    await expect(page.getByRole('heading', { level: 1, name: 'Plomberie Durand 1' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Réservée pour toi jusqu’au');
    await expect(page.getByRole('link', { name: 'Chercher sur Google' })).toHaveAttribute('href', /google\.com\/search\?q=PLOMBERIE%20DURAND%201%20VILLENEUVE/);
    await expect(page.getByRole('link', { name: 'Fiche officielle' })).toHaveAttribute('href', 'https://annuaire-entreprises.data.gouv.fr/entreprise/300000001');
    await expect(page.getByRole('button', { name: 'Ajoute d’abord un numéro' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Signé' })).toBeDisabled();
    await expectAccessible(page, 'fiche prospect');
    await expectNoHorizontalOverflow(page, 'fiche prospect');

    // Coordonnées : la source est obligatoire.
    const contact = page.getByRole('form', { name: 'Coordonnées de l’entreprise' });
    await contact.getByLabel('Téléphone').fill('04 90 12 34 56');
    await contact.getByLabel('Email').fill('Contact@Plomberie-Durand.fr');
    await contact.getByRole('button', { name: 'Enregistrer les coordonnées' }).click();
    await expect(contact.getByText('Indique où tu as trouvé ces coordonnées')).toBeVisible();
    await contact.getByLabel('Où les as-tu trouvées ?').fill('Site de l’entreprise, page Contact');
    await contact.getByRole('button', { name: 'Enregistrer les coordonnées' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Coordonnées enregistrées.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Appeler le 04 90 12 34 56' })).toHaveAttribute('href', 'tel:+33490123456');

    // Résultat d'appel : « à rappeler » ⇒ contacté.
    await page.getByRole('button', { name: 'Noter le résultat' }).click();
    const dialog = page.getByRole('dialog', { name: 'Résultat de l’appel' });
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(dialog.getByText('Choisis le résultat de l’appel.')).toBeVisible();
    await dialog.getByRole('button', { name: 'À rappeler' }).click();
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.pros-head-status')).toHaveText('Contacté');

    // Email : préparé par le serveur, envoyé depuis MA messagerie.
    await expect(page.getByLabel('Modèle')).toHaveValue('decouverte');
    await page.getByRole('button', { name: 'Préparer l’email' }).click();
    const preview = page.getByLabel('Aperçu de l’email');
    await expect(preview).toContainText('Plomberie Durand 1 : votre visibilité à Villeneuve-Les-Avignon');
    await expect(preview).toContainText('Pour ne plus être contacté par Stacker');
    const mailto = await page.getByRole('link', { name: 'Ouvrir ma messagerie' }).getAttribute('href');
    expect(mailto).toMatch(/^mailto:contact@plomberie-durand\.fr\?subject=/);
    const decoded = decodeURIComponent(mailto ?? '');
    expect(decoded).toContain('Bien cordialement,\nInès Martin\n+33611223344');
    expect(decoded).toMatch(/\/opposition\?t=[0-9a-f]{48}/);
    await expect(page.getByRole('link', { name: 'Gmail' })).toHaveAttribute('href', /^https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&to=contact@plomberie-durand\.fr/);
    await expect(page.getByRole('link', { name: 'Outlook' })).toHaveAttribute('href', /^https:\/\/outlook\.office\.com\/mail\/deeplink\/compose\?to=/);
    expect(supabase.fake.prospects.emails[0]?.marked_sent_at).toBeNull();
    await page.getByRole('button', { name: 'Je l’ai envoyé' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Envoi noté.' })).toBeVisible();
    const claim = supabase.fake.prospects.claims[0]!;
    expect(claim.status).toBe('contacte');
    expect(new Date(claim.expires_at!).getTime() - Date.now()).toBeGreaterThan(20 * 86_400_000);

    // Note et historique
    await page.getByLabel('Nouvelle note').fill('Rappeler mardi, demande un devis pour le site');
    await page.getByRole('button', { name: 'Ajouter la note' }).click();
    await expect(page.locator('.pros-notes')).toContainText('Rappeler mardi');
    await expect(page.locator('.pros-history')).toContainText('Email envoyé');
    await expect(page.locator('.pros-history')).toContainText('Appel : à rappeler');

    // Mes prospects
    await page.getByRole('link', { name: 'Mes prospects' }).click();
    await expect(page.getByRole('button', { name: 'Mes prospects (1)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.pros-list')).toContainText('Contacté');
    await expectAccessible(page, 'mes prospects');
  });

  test('exclusivité : B voit « Déjà suivie » et ne peut pas réserver', async ({ page, supabase, browser }) => {
    await login(page, supabase.fake);
    await openProspects(page);
    await searchBatiment(page);
    await page.getByRole('button', { name: 'Réserver Plomberie Durand 1' }).click();
    await expect(page.getByRole('link', { name: 'Ouvrir la fiche de Plomberie Durand 1' })).toBeVisible();

    // B, sur le même faux Supabase, dans un autre contexte.
    const ctx = await browser.newContext({ viewport: page.viewportSize() ?? { width: 390, height: 844 }, baseURL: 'http://localhost:4174', locale: 'fr-FR', timezoneId: 'Europe/Paris' });
    const pageB = await ctx.newPage();
    await pageB.route('https://e2e-stacker.supabase.co/**', async (route) => {
      if (!(await supabase.fake.handle(route))) await route.fulfill({ status: 404, json: {} });
    });
    await login(pageB, supabase.fake, 'bob@exemple.fr');
    await openProspects(pageB);
    await searchBatiment(pageB);
    const row = pageB.locator('.pros-list li').filter({ hasText: 'Plomberie Durand 1' }).first();
    await expect(row.getByText('Déjà suivie')).toBeVisible();
    await expect(row.getByRole('button', { name: /Réserver/ })).toHaveCount(0);
    expect(supabase.fake.prospects.claims).toHaveLength(1);
    await ctx.close();
  });

  test('opposition par le lien de l’email : la réservation est libérée et l’entreprise disparaît des recherches', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    await openProspects(page);
    await searchBatiment(page);
    await page.getByRole('button', { name: 'Réserver Plomberie Durand 1' }).click();
    await page.getByRole('link', { name: 'Ouvrir la fiche de Plomberie Durand 1' }).click();
    const contact = page.getByRole('form', { name: 'Coordonnées de l’entreprise' });
    await contact.getByLabel('Email').fill('contact@plomberie-durand.fr');
    await contact.getByLabel('Où les as-tu trouvées ?').fill('Site');
    await contact.getByRole('button', { name: 'Enregistrer les coordonnées' }).click();
    await page.getByRole('button', { name: 'Préparer l’email' }).click();
    const footer = await page.locator('.pros-mail-footer').innerText();
    const link = /https?:\/\/\S+\/opposition\?t=([0-9a-f]{48})/.exec(footer);
    expect(link).not.toBeNull();

    // Le destinataire clique sur le lien : page publique /opposition.
    await page.goto(`/opposition?t=${link![1]!}`);
    await expect(page.getByRole('heading', { level: 1, name: 'C’est noté' })).toBeVisible();
    expect(supabase.fake.prospects.claims[0]?.release_reason).toBe('opposition');

    await page.goto('/app/prospects?vue=mes');
    await expect(page.getByRole('heading', { name: 'Aucun prospect pour l’instant' })).toBeVisible();
    await page.getByRole('button', { name: 'Trouver', exact: true }).click();
    await page.getByRole('button', { name: 'J’ai compris, je m’engage' }).waitFor({ state: 'detached' }).catch(() => undefined);
    await page.getByRole('button', { name: 'Artisans du bâtiment' }).click();
    await page.getByRole('button', { name: 'Rechercher' }).click();
    await expect(page.getByRole('heading', { name: '11 entreprises' })).toBeVisible();
    await expect(page.locator('.pros-list')).not.toContainText('Plomberie Durand 1');
  });

  test('« il ne veut plus être contacté » depuis la fiche, avec confirmation', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    await openProspects(page);
    await searchBatiment(page);
    await page.getByRole('button', { name: 'Réserver Elec Sud 2' }).click();
    await page.getByRole('link', { name: 'Ouvrir la fiche de Elec Sud 2' }).click();
    await page.getByRole('button', { name: 'Il ne veut plus être contacté' }).click();
    const dialog = page.getByRole('dialog', { name: 'Ne plus jamais le contacter ?' });
    await expectAccessible(page, 'confirmation opposition');
    await dialog.getByRole('button', { name: 'Confirmer : ne plus le contacter' }).click();
    await expect(page).toHaveURL(/\/app\/prospects\?vue=mes$/);
    await expect(page.getByRole('status').filter({ hasText: 'Demande enregistrée.' })).toBeVisible();
    expect(supabase.fake.prospects.opposedSirens.has('300000002')).toBe(true);
  });

  test('adresse personnelle : avertissement ; profil sans nom : email refusé avec explication', async ({ page, supabase }) => {
    await login(page, supabase.fake, 'ines@exemple.fr', { department: '30' });
    await openProspects(page);
    await searchBatiment(page);
    await page.getByRole('button', { name: 'Réserver Plomberie Durand 1' }).click();
    await page.getByRole('link', { name: 'Ouvrir la fiche de Plomberie Durand 1' }).click();
    const contact = page.getByRole('form', { name: 'Coordonnées de l’entreprise' });
    await contact.getByLabel('Email').fill('paul.durand@plomberie-durand.fr');
    await contact.getByLabel('Où les as-tu trouvées ?').fill('Site, page équipe');
    await contact.getByRole('button', { name: 'Enregistrer les coordonnées' }).click();
    await expect(page.getByText('Adresse personnelle : n’écris que si elle est publiée pour le travail')).toBeVisible();
    await expect(page.getByText('Ton nom de famille apparaît dans la signature')).toBeVisible();
    await page.getByRole('button', { name: 'Préparer l’email' }).click();
    await expect(page.getByRole('alert')).toHaveText('Ajoute ton nom de famille dans ton profil : il apparaît dans la signature de tes emails.');
  });

  test('quota de recherches atteint : message clair, sans plantage', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    await openProspects(page);
    supabase.fake.prospects.searchFailNext = { status: 429, error: 'quota_exceeded' };
    await page.getByRole('button', { name: 'Rechercher' }).click();
    await expect(page.getByRole('alert')).toHaveText('Tu as atteint ta limite de recherches pour aujourd’hui. Elle se réinitialise demain matin.');
    supabase.fake.prospects.searchFailNext = { status: 503, error: 'source_busy' };
    await page.getByRole('button', { name: 'Rechercher' }).click();
    await expect(page.getByRole('alert')).toHaveText('Le registre des entreprises est très sollicité. Réessaie dans quelques secondes.');
    await page.getByRole('button', { name: 'Rechercher' }).click();
    await expect(page.getByRole('heading', { name: '30 entreprises' })).toBeVisible();
  });

  test('« pas intéressé » : libération et pause pour tous', async ({ page, supabase }) => {
    await login(page, supabase.fake);
    await openProspects(page);
    await searchBatiment(page);
    await page.getByRole('button', { name: 'Réserver Coiffure Lea 3' }).click();
    await page.getByRole('link', { name: 'Ouvrir la fiche de Coiffure Lea 3' }).click();
    await page.getByRole('button', { name: 'Noter le résultat' }).click();
    const dialog = page.getByRole('dialog', { name: 'Résultat de l’appel' });
    await dialog.getByRole('button', { name: 'Pas intéressé' }).click();
    await expect(dialog.getByText('mise en pause 6 mois pour tous les stackers')).toBeVisible();
    await dialog.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Prospect introuvable' })).toBeVisible();
    await page.getByRole('link', { name: 'Retour à mes prospects' }).click();
    await page.getByRole('button', { name: 'Trouver', exact: true }).click();
    await searchBatiment(page);
    await expect(page.locator('.pros-list li').filter({ hasText: 'Coiffure Lea 3' }).getByText('En pause')).toBeVisible();
  });
});
