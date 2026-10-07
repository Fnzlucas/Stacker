/**
 * Écran de démarrage de l'app (/app) et installation PWA.
 * - Peint par le HTML avant le JavaScript (aucun écran blanc), puis retiré
 *   quand l'app est prête, jamais avant la fin de l'animation d'entrée, ni
 *   longtemps après (aucun faux délai).
 * - Barre de progression seulement si le chargement dépasse 1,2 s.
 * - Mouvement réduit : écran statique, sortie immédiate.
 * - Aucun impact sur les pages publiques.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const PASSWORD = 'Plombier-Avignon-2026';

/** Horodatages (performance.now) : premier rendu, début de sortie, retrait de #boot. */
async function trackBoot(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __boot: { seen: boolean; leavingAt: number | null; removedAt: number | null; entryStart: number | null; entryDone: boolean | null } };
    w.__boot = { seen: false, leavingAt: null, removedAt: null, entryStart: null, entryDone: null };
    new MutationObserver(() => {
      const el = document.getElementById('boot');
      if (el) {
        w.__boot.seen = true;
        if (el.classList.contains('is-leaving') && w.__boot.leavingAt === null) {
          w.__boot.leavingAt = performance.now();
          // État des animations d'entrée au moment précis où la sortie commence.
          const anims = Array.from(el.querySelectorAll('[data-boot-entry]')).flatMap((n) => n.getAnimations());
          w.__boot.entryDone = anims.every((a) => a.playState === 'finished');
          const starts = anims.map((a) => Number(a.startTime)).filter((n) => Number.isFinite(n));
          w.__boot.entryStart = starts.length ? Math.min(...starts) : null;
        }
      } else if (w.__boot.seen && w.__boot.removedAt === null) {
        w.__boot.removedAt = performance.now();
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
}

async function bootTimes(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __boot: { seen: boolean; leavingAt: number | null; removedAt: number | null; entryStart: number | null; entryDone: boolean | null } };
    const fcp = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? null;
    return { ...w.__boot, fcp };
  });
}

/** Retarde le JavaScript de l'app : seul le HTML et la CSS sont là pendant `ms`. */
async function slowAppScript(page: Page, ms: number): Promise<void> {
  await page.route(/\/assets\/app-[\w-]+\.js$/, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

test.describe('écran de démarrage', () => {
  test('apparaît au lancement, puis disparaît une fois l’app prête (ni trop tôt, ni faux délai)', async ({ page }) => {
    await trackBoot(page);
    await page.goto('/app/connexion', { waitUntil: 'domcontentloaded' });
    const boot = page.locator('#boot');
    await expect(boot).toBeVisible();
    await expect(boot.locator('.boot-wordmark')).toHaveText('Stacker');
    await expect(boot.locator('.boot-bar')).toHaveCount(3);
    await expect(boot).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Content de te revoir' })).toBeVisible();

    const t = await bootTimes(page);
    expect(t.seen).toBe(true);
    expect(t.leavingAt, 'sortie animée').not.toBeNull();
    expect(t.removedAt).not.toBeNull();
    // Jamais avant la fin de l'animation d'entrée (920 ms)…
    expect(t.entryDone, 'animations d’entrée terminées au début de la sortie').toBe(true);
    expect(t.entryStart).not.toBeNull();
    expect(t.leavingAt! - t.entryStart!).toBeGreaterThanOrEqual(900);
    // … et pas de délai artificiel au-delà (l'app locale est prête bien avant la fin de l'entrée).
    expect(t.leavingAt! - t.entryStart!).toBeLessThan(1500);
    expect(t.removedAt! - t.leavingAt!).toBeLessThan(800);
  });

  test('statique dans le HTML avant le JavaScript, barre de progression après 1,2 s seulement', async ({ page }) => {
    await slowAppScript(page, 2500);
    // « commit » : DOMContentLoaded attendrait le module de l'app (retardé ici).
    await page.goto('/app/connexion', { waitUntil: 'commit' });
    const boot = page.locator('#boot');
    // Aucun écran blanc : le logo et le wordmark sont peints sans JavaScript.
    await expect(boot).toBeVisible();
    await expect(boot).toHaveAttribute('role', 'status');
    await expect(boot.getByText('Chargement de Stacker…')).toBeAttached();
    await expect(boot.locator('.boot-progress')).toHaveCSS('opacity', '0');
    await expect(boot.locator('.boot-wordmark')).toHaveCSS('opacity', '1');
    await expect(boot.locator('.boot-progress')).toHaveCSS('opacity', '1', { timeout: 2000 });
    await expect(boot.locator('.boot-slow')).toBeHidden();
    // Le JavaScript arrive : l'app prend le relais.
    await expect(boot).toHaveCount(0, { timeout: 8000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Content de te revoir' })).toBeVisible();
  });

  test('restauration de session : l’écran couvre le chargement, puis l’accueil connecté', async ({ page, supabase }) => {
    supabase.fake.seedUser({ email: 'ines@exemple.fr', password: PASSWORD, firstName: 'Inès', onboarded: true });
    await page.goto('/app/connexion');
    await page.getByLabel('Adresse email').fill('ines@exemple.fr');
    await page.getByLabel('Mot de passe', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();

    await trackBoot(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#boot')).toBeVisible();
    await expect(page.locator('#boot')).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navigation de l’application' })).toBeVisible();
    const t = await bootTimes(page);
    // L'écran n'est parti qu'une fois le profil affiché (jamais d'écran intermédiaire visible).
    expect(t.removedAt).not.toBeNull();
  });

  test('mouvement réduit : écran statique, sortie immédiate sans animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await trackBoot(page);
    await slowAppScript(page, 2000);
    await page.goto('/app/connexion', { waitUntil: 'commit' });
    const boot = page.locator('#boot');
    await expect(boot).toBeVisible();
    for (const sel of ['.boot-tile', '.boot-bar-1', '.boot-bar-2', '.boot-bar-3', '.boot-wordmark']) {
      await expect(boot.locator(sel)).toHaveCSS('animation-name', 'none');
    }
    await expect(boot.locator('.boot-wordmark')).toHaveCSS('opacity', '1');
    await expect(boot.locator('.boot-progress')).toBeHidden();
    await expect(boot).toHaveCount(0, { timeout: 6000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Content de te revoir' })).toBeVisible();
    const t = await bootTimes(page);
    expect(t.leavingAt, 'aucune transition de sortie').toBeNull();
  });

  test('pages publiques : aucun écran de démarrage ni manifeste', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#boot')).toHaveCount(0);
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    const css = await page.evaluate(() => Array.from(document.styleSheets).some((s) => Array.from(s.cssRules).some((r) => r.cssText.includes('.boot-'))));
    expect(css, 'la CSS du splash n’est pas chargée sur le site public').toBe(false);
  });
});

test.describe('installation PWA', () => {
  test('manifeste, icônes générées depuis le logo et métadonnées iOS/Android', async ({ page, request }) => {
    await page.goto('/app/connexion');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ececf0');
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Stacker');

    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/manifest+json');
    const manifest = (await res.json()) as { start_url: string; scope: string; display: string; icons: { src: string; sizes: string; purpose: string }[] };
    expect(manifest).toMatchObject({ start_url: '/app', scope: '/app', display: 'standalone' });
    expect(manifest.icons.map((i) => i.purpose).sort()).toEqual(['any', 'any', 'maskable']);

    const icons = [...manifest.icons.map((i) => ({ src: i.src, size: Number(i.sizes.split('x')[0]) })), { src: '/icons/apple-touch-icon.png', size: 180 }];
    for (const icon of icons) {
      const png = await request.get(icon.src);
      expect(png.status(), icon.src).toBe(200);
      expect(png.headers()['content-type']).toBe('image/png');
      const body = await png.body();
      // En-tête IHDR : largeur et hauteur réelles du PNG.
      expect([body.readUInt32BE(16), body.readUInt32BE(20)], icon.src).toEqual([icon.size, icon.size]);
      expect(body.length, `${icon.src} : poids`).toBeLessThan(30_000);
    }
  });
});
