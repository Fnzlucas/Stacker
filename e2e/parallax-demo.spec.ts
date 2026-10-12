/**
 * Démo du parallaxe de la landing (vidéo de défilement), à la demande : DEMO=1.
 *   DEMO=1 pnpm exec playwright test e2e/parallax-demo.spec.ts
 */
import { expect, test } from './fixtures';

test('défilement de la landing', async ({ browser }, info) => {
  test.skip(!process.env['DEMO'], 'démo à la demande : DEMO=1');
  test.setTimeout(120_000);
  const mobile = info.project.name.includes('mobile');
  const size = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const ctx = await browser.newContext({ viewport: size, isMobile: mobile, hasTouch: mobile, baseURL: 'http://localhost:4174', recordVideo: { dir: `qa/demo/.raw/parallax-${info.project.name}`, size } });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.locator('html.motion')).toHaveCount(1);
  await page.waitForTimeout(1200);
  const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const end = Math.min(total, mobile ? 9000 : 5200);
  for (let y = 0; y <= end; y += 18) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(600);
  await ctx.close();
});
