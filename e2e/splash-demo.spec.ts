/**
 * Vidéo de démonstration de l'écran de démarrage (390×844), à la demande :
 *   DEMO=1 pnpm exec playwright test e2e/splash-demo.spec.ts --project=mobile-390
 *   ffmpeg -y -i qa/demo/splash.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart qa/demo/splash.mp4
 * (`pnpm qa:demo:splash` enchaîne les deux.)
 * Deux lancements : chargement rapide, puis chargement lent (> 1,2 s : barre de progression).
 */
import { renameSync } from 'node:fs';
import { expect, test } from './fixtures';

test.skip(!process.env['DEMO'], 'vidéo à la demande : DEMO=1');

test('démo : écran de démarrage de l’app', async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'fr-FR',
    recordVideo: { dir: 'qa/demo/.raw', size: { width: 390, height: 844 } },
  });
  const page = await context.newPage();
  // Écran vierge de la couleur du fond avant le premier lancement.
  await page.setContent('<body style="margin:0;background:#ececf0"></body>');
  await page.waitForTimeout(600);

  // 1. Lancement normal.
  await page.goto('/app/connexion');
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 5000 });
  await page.waitForTimeout(1600);

  // 2. Lancement lent (réseau mobile) : la barre de progression apparaît après 1,2 s.
  await page.route(/\/assets\/app-[\w-]+\.js$/, async (route) => {
    await new Promise((r) => setTimeout(r, 2600));
    await route.continue();
  });
  await page.setContent('<body style="margin:0;background:#ececf0"></body>');
  await page.waitForTimeout(400);
  await page.goto('/app/connexion', { waitUntil: 'commit' });
  await expect(page.locator('#boot')).toHaveCount(0, { timeout: 8000 });
  await page.waitForTimeout(1600);

  const video = page.video();
  await context.close();
  renameSync(await video!.path(), 'qa/demo/splash.webm');
});
