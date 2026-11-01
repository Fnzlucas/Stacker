// Icône App Store (1024 × 1024, opaque, sans transparence) et écran de
// lancement de l'application iPhone, depuis le logo (design/logo.js).
// À relancer seulement si le logo change :
//   node scripts/gen-ios-assets.mjs
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { LOGO_COLORS, logoSVG } from '../design/logo.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'ios/App/App/Assets.xcassets');

function fullBleed(size) {
  const S = 100;
  const bw = S * 0.58;
  const bh = S * 0.125;
  const gap = S * 0.06;
  const bx = (S - bw) / 2;
  const by = (S - (bh * 3 + gap * 2)) / 2;
  const bars = LOGO_COLORS.bars.map((c, i) => `<rect x="${bx}" y="${by + i * (bh + gap)}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${c}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">
<defs><linearGradient id="g" x1=".33" y1=".03" x2=".67" y2=".97"><stop offset="0" stop-color="${LOGO_COLORS.tileFrom}"/><stop offset="1" stop-color="${LOGO_COLORS.tileTo}"/></linearGradient></defs>
<rect width="100" height="100" fill="url(#g)"/>${bars}</svg>`;
}

const splash = (size) =>
  `<div style="width:${size}px;height:${size}px;background:#ececf0;display:grid;place-items:center">${logoSVG({ size: Math.round(size * 0.16) })}</div>`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const shots = [
    { path: join(assets, 'AppIcon.appiconset/AppIcon-512@2x.png'), size: 1024, html: fullBleed(1024), sel: 'svg' },
    ...readdirSync(join(assets, 'Splash.imageset'))
      .filter((f) => f.endsWith('.png'))
      .map((f) => ({ path: join(assets, 'Splash.imageset', f), size: 2732, html: splash(2732), sel: 'div' })),
  ];
  for (const s of shots) {
    const page = await browser.newPage({ viewport: { width: s.size, height: s.size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0">${s.html}</body></html>`);
    await page.locator(s.sel).first().screenshot({ path: s.path, omitBackground: false });
    await page.close();
    // L'App Store refuse une icône avec couche de transparence.
    spawnSync('convert', [s.path, '-alpha', 'off', '-strip', '-define', 'png:compression-level=9', s.path]);
    console.log(`✓ ${s.path.replace(root + '/', '')}`);
  }
} finally {
  await browser.close();
}
