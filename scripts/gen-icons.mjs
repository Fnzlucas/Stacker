// Génère les icônes PWA de l'app (public/icons/*.png) depuis le logo
// (design/logo.js), avec le Chromium de Playwright déjà présent sur la
// machine. À relancer seulement si le logo change :
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/gen-icons.mjs
//
// - icon-192.png, icon-512.png : tuile arrondie, fond transparent (« any ») ;
// - icon-maskable-512.png : plein cadre, barres dans la zone sûre (80 %) ;
// - apple-touch-icon.png (180) : plein cadre opaque, iOS arrondit lui-même.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { LOGO_COLORS, logoSVG } from '../design/logo.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/icons');
mkdirSync(out, { recursive: true });

/** Plein cadre : dégradé de la tuile sans coins arrondis, barres réduites à `scale`. */
function fullBleed(size, scale) {
  const S = 100;
  const bw = S * 0.58 * scale;
  const bh = S * 0.125 * scale;
  const gap = S * 0.06 * scale;
  const bx = (S - bw) / 2;
  const by = (S - (bh * 3 + gap * 2)) / 2;
  const bars = LOGO_COLORS.bars
    .map((c, i) => `<rect x="${bx}" y="${by + i * (bh + gap)}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${c}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">
<defs><linearGradient id="g" x1=".33" y1=".03" x2=".67" y2=".97"><stop offset="0" stop-color="${LOGO_COLORS.tileFrom}"/><stop offset="1" stop-color="${LOGO_COLORS.tileTo}"/></linearGradient></defs>
<rect width="100" height="100" fill="url(#g)"/>${bars}</svg>`;
}

const icons = [
  { file: 'icon-192.png', size: 192, svg: logoSVG({ size: 192 }), transparent: true },
  { file: 'icon-512.png', size: 512, svg: logoSVG({ size: 512 }), transparent: true },
  { file: 'icon-maskable-512.png', size: 512, svg: fullBleed(512, 0.8), transparent: false },
  { file: 'apple-touch-icon.png', size: 180, svg: fullBleed(180, 1), transparent: false },
];

const browser = await chromium.launch();
try {
  for (const icon of icons) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${icon.svg}</body></html>`);
    await page.locator('svg').screenshot({ path: join(out, icon.file), omitBackground: icon.transparent });
    await page.close();
    // Allègement (≈ ×4) : palette de 256 couleurs, compression maximale (ImageMagick, si présent).
    spawnSync('convert', [join(out, icon.file), '-strip', '-colors', '256', '-define', 'png:compression-level=9', join(out, icon.file)]);
    console.log(`✓ public/icons/${icon.file}`);
  }
} finally {
  await browser.close();
}
