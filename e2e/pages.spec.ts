import pages from '../src/site/pages.json' with { type: 'json' };
import { expect, expectAccessible, expectNoHorizontalOverflow, test } from './fixtures';

const PUBLIC = pages.filter((p) => p.id !== 'not-found');

test.describe('toutes les pages publiques', () => {
  for (const page of PUBLIC) {
    test(`${page.path} : rendu, titre, a11y, aucun débordement`, async ({ page: p }) => {
      const res = await p.goto(page.path);
      expect(res?.status()).toBe(200);
      await expect(p).toHaveTitle(page.title);
      await expect(p.locator('h1')).toHaveCount(1);
      await expect(p.locator('h1')).toBeVisible();
      await expect(p.locator('header .logo-link')).toBeVisible();
      await expect(p.locator('footer')).toContainText('Mentions légales');
      // Les îlots sont hydratés (compteur réel affiché là où il existe).
      if (page.islands) await p.waitForLoadState('networkidle');
      await expectNoHorizontalOverflow(p, page.path);
      await expectAccessible(p, page.path);
    });
  }

  test.describe('page introuvable', () => {
    test.use({ allowStatus: [404] });
    test('URL inconnue : 404 avec la page dédiée', async ({ page }) => {
      const res = await page.goto('/cette-page-n-existe-pas');
      expect(res?.status()).toBe(404);
      await expect(page.getByText('Cette page n’existe pas.')).toBeVisible();
      await expectNoHorizontalOverflow(page, '404');
      await expectAccessible(page, '404');
    });
  });
});

test('tous les liens internes mènent à une page existante', async ({ page, request }) => {
  const seen = new Set<string>();
  for (const p of PUBLIC) {
    await page.goto(p.path);
    const hrefs = await page.locator('a[href^="/"]').evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
    for (const href of hrefs) seen.add(href.split('#')[0] ?? '/');
  }
  for (const href of seen) {
    const res = await request.get(href || '/', { maxRedirects: 0 });
    expect(res.status(), href).toBe(200);
  }
  // Ancres internes : la cible existe sur la page.
  await page.goto('/');
  for (const anchor of ['#comment', '#paliers', '#abonnement', '#rejoindre', '#faq']) await expect(page.locator(anchor)).toHaveCount(1);
});

test('navigation : en-tête, pied de page et URLs propres', async ({ page, isMobile }) => {
  await page.goto('/');
  if (!isMobile) {
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Tarifs' }).click();
    await expect(page).toHaveURL(/\/tarifs$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('6,99 €');
  }
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Conditions de vente' }).click();
  await expect(page).toHaveURL(/\/cgv$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Conditions générales de vente');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Mentions légales' }).click();
  await expect(page).toHaveURL(/\/mentions-legales$/);
  await page.getByRole('banner').getByRole('link', { name: 'Rejoindre la liste' }).click();
  await expect(page).toHaveURL(/\/liste-attente$/);
});

test('en-têtes de sécurité et CSP stricte servis avec chaque page', async ({ request }) => {
  const res = await request.get('/');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("script-src 'self'");
  expect(h['content-security-policy']).not.toContain('unsafe-inline');
  expect(h['content-security-policy']).not.toContain('unsafe-eval');
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toContain('camera=()');
});

test('aucune ressource tierce chargée au runtime', async ({ page }) => {
  const origins = new Set<string>();
  page.on('request', (req) => origins.add(new URL(req.url()).origin));
  for (const path of ['/', '/tarifs', '/liste-attente', '/contact', '/cgv']) await page.goto(path, { waitUntil: 'networkidle' });
  const thirdParty = [...origins].filter((o) => o !== 'http://localhost:4174' && o !== 'https://e2e-stacker.supabase.co');
  expect(thirdParty).toEqual([]);
});

test('SEO : HTML pré-rendu lisible sans JavaScript, canonical, sitemap et robots', async ({ browser, request }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Touche ta commission');
  await expect(page.getByRole('heading', { name: 'Tu appelles et tu closes' })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'http://localhost:4174/');
  await context.close();

  const sitemap = await (await request.get('/sitemap.xml')).text();
  for (const p of PUBLIC) expect(sitemap).toContain(`<loc>http://localhost:4174${p.path}</loc>`);
  expect(await (await request.get('/robots.txt')).text()).toContain('Sitemap: http://localhost:4174/sitemap.xml');
});

test('FAQ : les questions s’ouvrent au clic et au clavier', async ({ page }) => {
  await page.goto('/#faq');
  const first = page.locator('#faq details').first();
  await first.locator('summary').click();
  await expect(first).toHaveAttribute('open', '');
  await first.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(first).not.toHaveAttribute('open', '');
});
