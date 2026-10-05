/**
 * Captures de recette visuelle (390×844, pleine page) dans qa/shots-lot1/.
 * Lancées à la demande : `pnpm qa:shots` (SHOTS=1).
 */
import pages from '../src/site/pages.json' with { type: 'json' };
import { UNCONFIGURED, expect, test } from './fixtures';

const DIR = 'qa/shots-lot1';

test.describe('captures 390×844', () => {
  test.skip(!process.env['SHOTS'], 'captures à la demande : SHOTS=1');
  test.skip(({ isMobile }) => !isMobile, 'captures mobiles uniquement');
  // Densité 1 : Chromium ne peint pas au-delà de 16 384 px de haut (pages longues en densité 2).
  test.use({ allowStatus: [404], deviceScaleFactor: 1 });

  for (const p of pages) {
    test(`capture ${p.id}`, async ({ page }) => {
      await page.goto(p.id === 'not-found' ? '/introuvable' : p.path, { waitUntil: 'networkidle' });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.screenshot({ path: `${DIR}/${p.id}.png`, fullPage: true, animations: 'disabled' });
    });
  }

  test('capture états du formulaire', async ({ page }) => {
    await page.goto('/liste-attente', { waitUntil: 'networkidle' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const form = page.getByTestId('waitlist-form');
    await form.getByRole('button', { name: 'Rejoindre la liste d’attente' }).click();
    await page.screenshot({ path: `${DIR}/etat-formulaire-erreurs.png`, animations: 'disabled' });

    await form.getByLabel('Prénom').fill('Inès');
    await form.getByLabel('Adresse email').fill('ines@exemple.fr');
    await form.getByLabel('Je déclare avoir 18 ans ou plus.').check();
    await form.getByLabel(/J’accepte les conditions d’utilisation/).check();
    await form.getByRole('button', { name: 'Rejoindre la liste d’attente' }).click();
    const success = page.getByTestId('waitlist-success');
    await expect(success).toBeVisible();
    await page.screenshot({ path: `${DIR}/etat-inscription-reussie.png`, animations: 'disabled' });

    await page.goto(`${UNCONFIGURED}/liste-attente`, { waitUntil: 'networkidle' });
    await page.getByTestId('waitlist-form').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${DIR}/etat-supabase-non-configure.png`, animations: 'disabled' });
  });
});
