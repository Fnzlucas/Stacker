// Génère les gabarits HTML des pages (entrées multi-pages Vite) depuis
// src/site/pages.json. Ces fichiers sont des artefacts (ignorés par git) :
// on modifie pages.json, jamais les .html à la racine.
//
// Jetons remplacés plus tard (scripts/build.mjs, ou vite.config.ts en dev) :
//   %%SITE_URL%%        URL publique du site (canonical, og:url)
//   <!--ssr-outlet-->   HTML pré-rendu de la page (React renderToString)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const pages = JSON.parse(readFileSync(join(root, 'src/site/pages.json'), 'utf8'));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const PRELOAD_FONTS = ['InterDisplay-ExtraBold.woff2', 'Inter-Regular.woff2', 'Inter-SemiBold.woff2'];

export function renderTemplate(page) {
  const canonical = page.path === '/' ? '%%SITE_URL%%/' : `%%SITE_URL%%${page.path}`;
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}">`,
    page.noindex ? '<meta name="robots" content="noindex, nofollow">' : `<link rel="canonical" href="${canonical}">`,
    '<meta name="theme-color" content="#ececf0">',
    '<meta name="color-scheme" content="light">',
    '<meta name="format-detection" content="telephone=no">',
    '<meta property="og:site_name" content="Stacker">',
    '<meta property="og:locale" content="fr_FR">',
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${esc(page.title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    page.noindex ? '' : `<meta property="og:url" content="${canonical}">`,
    '<meta name="twitter:card" content="summary">',
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    ...PRELOAD_FONTS.map((f) => `<link rel="preload" href="/fonts/${f}" as="font" type="font/woff2" crossorigin>`),
    '<link rel="stylesheet" href="/src/styles/main.css">',
    page.islands ? '<script type="module" src="/src/entries/islands.tsx"></script>' : '',
  ].filter(Boolean);

  return `<!doctype html>
<html lang="fr">
<head>
${head.join('\n')}
</head>
<body class="grain">
<div id="root" data-page="${esc(page.id)}"><!--ssr-outlet--></div>
</body>
</html>
`;
}

export function writeTemplates() {
  for (const page of pages) writeFileSync(join(root, page.file), renderTemplate(page));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) writeTemplates();
