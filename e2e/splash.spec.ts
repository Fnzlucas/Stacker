/**
 * Écran de démarrage de l'app (/app) et installation PWA.
 * - Peint par le HTML avant le JavaScript (aucun écran blanc), puis retiré
 *   quand l'app est prête, jamais avant la fin de l'animation d'entrée, ni
 *   longtemps après (aucun faux délai).
 * - UNE seule animation continue : jamais remontée ni redémarrée par React,
 *   même avec un processeur lent (CPU ×4).
 * - Barre de progression seulement si le chargement dépasse 1,6 s ; la tuile
 *   « respire » sans que l'entrée recommence.
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
          const anims = el.getAnimations({ subtree: true }).filter((a) => (a as CSSAnimation).animationName.startsWith('boot-in-'));
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
    await expect(boot.locator('.boot-word')).toHaveText('Stacker');
    await expect(boot.locator('.boot-l')).toHaveCount(7);
    await expect(boot.locator('.boot-bar')).toHaveCount(3);
    await expect(boot.locator('.boot-band')).toHaveCount(3);
    await expect(boot).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Content de te revoir' })).toBeVisible();

    const t = await bootTimes(page);
    expect(t.seen).toBe(true);
    expect(t.leavingAt, 'sortie animée').not.toBeNull();
    expect(t.removedAt).not.toBeNull();
    // Jamais avant la fin de l'animation d'entrée (1590 ms)…
    expect(t.entryDone, 'animations d’entrée terminées au début de la sortie').toBe(true);
    expect(t.entryStart).not.toBeNull();
    expect(t.leavingAt! - t.entryStart!).toBeGreaterThanOrEqual(1570);
    // … et pas de délai artificiel au-delà (l'app locale est prête bien avant la fin de l'entrée).
    expect(t.leavingAt! - t.entryStart!).toBeLessThan(2200);
    // Sortie (bandes) ≈ 520 ms.
    expect(t.removedAt! - t.leavingAt!).toBeGreaterThanOrEqual(450);
    expect(t.removedAt! - t.leavingAt!).toBeLessThan(1000);
  });

  test('statique dans le HTML avant le JavaScript, respiration et barre de progression après 1,6 s seulement', async ({ page }) => {
    await slowAppScript(page, 3000);
    // « commit » : DOMContentLoaded attendrait le module de l'app (retardé ici).
    await page.goto('/app/connexion', { waitUntil: 'commit' });
    const boot = page.locator('#boot');
    // Aucun écran blanc : le logo et le wordmark sont peints sans JavaScript.
    await expect(boot).toBeVisible();
    await expect(boot).toHaveAttribute('role', 'status');
    await expect(boot.getByText('Chargement de Stacker…')).toBeAttached();
    await expect(boot.locator('.boot-progress')).toHaveCSS('opacity', '0');
    // Entrée finie (≈ 1,6 s) : wordmark en place, la tuile respire, la barre apparaît.
    await expect(boot.locator('.boot-progress')).toHaveCSS('opacity', '1', { timeout: 2500 });
    await expect(boot.locator('.boot-logo')).toHaveCSS('animation-name', 'boot-breathe');
    const state = await page.evaluate(() => {
      const anims = document.getElementById('boot')!.getAnimations({ subtree: true });
      const by = (p: string) => anims.filter((a) => (a as CSSAnimation).animationName.startsWith(p));
      return { entry: by('boot-in-').map((a) => a.playState), breathe: by('boot-breathe').map((a) => a.playState) };
    });
    expect(state.entry.length, 'animations d’entrée').toBeGreaterThan(10);
    expect(new Set(state.entry), 'l’entrée reste terminée, elle ne recommence pas').toEqual(new Set(['finished']));
    expect(state.breathe).toEqual(['running']);
    await expect(boot.locator('.boot-slow')).toBeHidden();
    // Le JavaScript arrive : l'app prend le relais.
    await expect(boot).toHaveCount(0, { timeout: 8000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Content de te revoir' })).toBeVisible();
  });

  test('une seule animation continue : jamais remontée ni redémarrée, même avec un processeur lent (CPU ×4)', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'ralentissement CPU via CDP (Chromium)');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // À chaque image : même élément #boot, mêmes objets Animation, même startTime, horloge croissante.
    await page.addInitScript(() => {
      const s = { frames: 0, replaced: false, restarts: 0, backwards: 0, leaving: false };
      (window as unknown as { __splash: typeof s }).__splash = s;
      let ref: HTMLElement | null = null;
      type Seen = Map<string, { a: Animation; start: number | null; time: number }>;
      const seen = new WeakMap<Element, Seen>();
      const tick = () => {
        const el = document.getElementById('boot');
        if (!el) return;
        if (ref && el !== ref) s.replaced = true;
        ref = el;
        s.frames++;
        s.leaving ||= el.classList.contains('is-leaving');
        for (const a of el.getAnimations({ subtree: true })) {
          const name = (a as CSSAnimation).animationName;
          if (!name.startsWith('boot-in-')) continue;
          const target = (a.effect as KeyframeEffect).target!;
          const byName: Seen = seen.get(target) ?? new Map();
          seen.set(target, byName);
          const prev = byName.get(name);
          const time = Number(a.currentTime);
          const startTime = a.startTime === null ? null : Number(a.startTime);
          if (prev && (prev.a !== a || (prev.start !== null && startTime !== prev.start))) s.restarts++;
          if (prev && time < prev.time) s.backwards++;
          byName.set(name, { a, start: prev?.start ?? startTime, time });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto('/app/connexion', { waitUntil: 'commit' });
    await expect(page.locator('#boot')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Content de te revoir' })).toBeVisible();
    const s = await page.evaluate(() => (window as unknown as { __splash: { frames: number; replaced: boolean; restarts: number; backwards: number; leaving: boolean } }).__splash);
    expect(s.frames, 'images observées').toBeGreaterThan(20);
    expect(s.replaced, '#boot remplacé').toBe(false);
    expect(s.restarts, 'animation redémarrée').toBe(0);
    expect(s.backwards, 'horloge d’animation revenue en arrière').toBe(0);
    expect(s.leaving, 'sortie animée observée').toBe(true);
    // Uniquement des propriétés exécutables par le compositeur, sur des éléments HTML (pas d'enfant SVG).
    const props = await page.evaluate(async () => {
      const r = await fetch(document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')!.href);
      const css = await r.text();
      const frames = [...css.matchAll(/@keyframes (boot-[\w-]+)\{(.*?\})\}/gs)];
      return frames.map(([, name, body]) => ({ name, props: [...new Set([...body!.matchAll(/([a-z-]+):/g)].map((m) => m[1]))] }));
    });
    expect(props.length).toBeGreaterThan(10);
    for (const { name, props: list } of props) {
      const allowed = name === 'boot-reveal' ? ['visibility'] : ['transform', 'opacity', 'animation-timing-function'];
      expect(list.filter((p) => !allowed.includes(p!)), name).toEqual([]);
    }
    await expect(page.locator('svg.boot-tile, .boot rect')).toHaveCount(0);
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
    for (const sel of ['.boot-tile', '.boot-shine', '.boot-logo', '.boot-bars', '.boot-bx', '.boot-by', '.boot-bs', '.boot-l']) {
      for (const el of await boot.locator(sel).all()) await expect(el).toHaveCSS('animation-name', 'none');
    }
    // Logo et wordmark en place, sobres : aucune transformation résiduelle.
    await expect(boot.locator('.boot-l').first()).toHaveCSS('transform', 'none');
    await expect(boot.locator('.boot-bs').first()).toHaveCSS('transform', 'none');
    await expect(boot.locator('.boot-word')).toHaveCSS('opacity', '1');
    await expect(boot.locator('.boot-progress')).toBeHidden();
    await expect(boot.locator('.boot-bands')).toBeHidden();
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
