/**
 * Vidéo de démonstration de l'écran de démarrage, rendue IMAGE PAR IMAGE
 * (aucune capture en temps réel, donc aucune image perdue ni saccade due à
 * l'enregistreur) : les animations CSS de #boot sont mises en pause et leur
 * horloge (Animation.currentTime) est fixée pour chaque image, à 30 i/s.
 *   DEMO=1 pnpm exec playwright test e2e/splash-demo.spec.ts --project=mobile-390
 * produit qa/demo/.raw/frames/*.png (780×1688), puis `pnpm qa:demo:splash`
 * les assemble en qa/demo/splash_v2.mp4 (H.264, yuv420p, 30 i/s).
 * Scénario : lancement de l'app connectée → entrée complète → sortie vers
 * l'accueil (« Bonjour Inès »).
 */
import { mkdirSync, rmSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

test.skip(!process.env['DEMO'], 'vidéo à la demande : DEMO=1');

const FPS = 30;
const DIR = 'qa/demo/.raw/frames';
const ENTRY_MS = 1590;
const EXIT_MS = 520;
const EXIT_NAMES = ['boot-hide', 'boot-bar-out', 'boot-tile-out', 'boot-word-out', 'boot-band'];

test('démo : écran de démarrage v2, image par image', async ({ page, supabase }) => {
  test.setTimeout(120_000);
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });

  // Session existante : le lancement mène à l'accueil connecté.
  supabase.fake.seedUser({ email: 'ines@exemple.fr', password: 'Plombier-Avignon-2026', firstName: 'Inès', onboarded: true });
  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill('ines@exemple.fr');
  await page.getByLabel('Mot de passe', { exact: true }).fill('Plombier-Avignon-2026');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();

  // Pour la capture seulement : #boot n'est retiré qu'à la fin du rendu.
  await page.addInitScript(() => {
    const w = window as unknown as { __holdBoot: boolean; __removeBoot: () => void };
    const detach = (el: Element) => el.parentNode?.removeChild(el);
    w.__holdBoot = true;
    Element.prototype.remove = function (this: Element) {
      if (this.id === 'boot' && w.__holdBoot) return;
      detach(this);
    };
    w.__removeBoot = () => {
      w.__holdBoot = false;
      document.getElementById('boot')?.remove();
    };
  });
  // Le JavaScript de l'app attend la fin du rendu de l'entrée.
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(/\/assets\/app-[\w-]+\.js$/, async (route) => {
    await gate;
    await route.continue();
  });

  await page.goto('/app', { waitUntil: 'commit' });
  await page.locator('#boot').waitFor();
  await page.evaluate(() => document.fonts.ready);

  let n = 0;
  const shot = async () => page.screenshot({ path: `${DIR}/${String(n++).padStart(4, '0')}.png` });
  const setTime = (p: Page, t: number, names: string[] | null) =>
    p.evaluate(
      ([t, names]) => {
        for (const a of document.getElementById('boot')!.getAnimations({ subtree: true })) {
          const name = (a as CSSAnimation).animationName;
          if (names && !names.includes(name)) continue;
          a.pause();
          a.currentTime = t;
        }
      },
      [t, names] as const,
    );

  // 1. Entrée : une image toutes les 33,3 ms, de 0 à la fin exacte.
  const entryFrames = Math.ceil((ENTRY_MS * FPS) / 1000);
  for (let i = 0; i <= entryFrames; i++) {
    await setTime(page, Math.min(ENTRY_MS, (i * 1000) / FPS), null);
    await shot();
  }
  // Entrée terminée (finish) : boot.ts peut lancer la sortie dès que l'app est prête.
  await page.evaluate(() => {
    for (const a of document.getElementById('boot')!.getAnimations({ subtree: true })) {
      if ((a as CSSAnimation).animationName.startsWith('boot-in-')) a.finish();
    }
  });

  // 2. L'app charge et rend l'accueil sous l'écran ; boot.ts déclenche la sortie.
  release();
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('is-leaving'));
  await setTime(page, 0, EXIT_NAMES);
  await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeAttached();
  const exitFrames = Math.ceil((EXIT_MS * FPS) / 1000);
  for (let i = 1; i <= exitFrames; i++) {
    await setTime(page, Math.min(EXIT_MS, (i * 1000) / FPS), EXIT_NAMES);
    await shot();
  }

  // 3. Accueil, 1 s (images fixes voulues).
  await page.evaluate(() => (window as unknown as { __removeBoot: () => void }).__removeBoot());
  await expect(page.locator('#boot')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();
  for (let i = 0; i < FPS; i++) await shot();
});
