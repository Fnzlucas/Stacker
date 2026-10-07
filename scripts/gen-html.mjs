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

/**
 * Application connectée (/app/*) : SPA React, non indexée. Le HTML ne
 * contient qu'un écran de démarrage ; tout le reste est rendu par
 * src/entries/app.tsx après vérification de la session.
 */
export const APP_FILE = 'app.html';

/**
 * Écran de démarrage statique de l'app (#boot) : peint avant le JavaScript
 * (aucun écran blanc), animé en CSS uniquement (transform et opacity), puis
 * retiré par src/app/boot.ts quand l'app est prête. Aucun script ni style
 * inline (CSP). Géométrie du logo : design/logo.js (tuile 23 %, barres
 * 58 % × 12,5 %, écart 6 %). Les barres s'empilent de bas en haut.
 */
export const BOOT_SPLASH = `<div id="boot" class="boot" role="status">
<div class="boot-stage">
<svg class="boot-tile" data-boot-entry viewBox="0 0 100 100" width="96" height="96" aria-hidden="true" focusable="false">
<defs>
<linearGradient id="boot-g" x1=".33" y1=".03" x2=".67" y2=".97"><stop offset="0" stop-color="#2a2a33"/><stop offset="1" stop-color="#0a0a0e"/></linearGradient>
<linearGradient id="boot-h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<rect width="100" height="100" rx="23" fill="url(#boot-g)"/>
<rect x=".75" y=".75" width="98.5" height="98.5" rx="22.25" fill="url(#boot-h)" stroke="#fff" stroke-opacity=".09" stroke-width="1.5"/>
<rect class="boot-bar boot-bar-1" data-boot-entry x="21" y="25.25" width="58" height="12.5" rx="6.25" fill="#3ccf63"/>
<rect class="boot-bar boot-bar-2" data-boot-entry x="21" y="43.75" width="58" height="12.5" rx="6.25" fill="#7b7bf0"/>
<rect class="boot-bar boot-bar-3" data-boot-entry x="21" y="62.25" width="58" height="12.5" rx="6.25" fill="#f7a21b"/>
</svg>
<span class="boot-wordmark" data-boot-entry aria-hidden="true">Stacker</span>
<span class="boot-progress" aria-hidden="true"><span class="boot-progress-bar"></span></span>
<p class="boot-slow">Le chargement prend plus de temps que prévu. <a href="/app">Recharger</a></p>
<noscript><p class="boot-noscript">L’espace stacker a besoin de JavaScript. <a href="/">Retour au site</a></p></noscript>
</div>
<span class="sr-only">Chargement de Stacker…</span>
</div>`;

export function renderAppTemplate() {
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<title>Stacker</title>',
    '<meta name="description" content="Espace stacker : prospects, deals, commissions et profil.">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="theme-color" content="#ececf0">',
    '<meta name="color-scheme" content="light">',
    '<meta name="format-detection" content="telephone=no">',
    '<meta name="referrer" content="strict-origin-when-cross-origin">',
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    // Installation sur l'écran d'accueil (PWA) : manifeste et icônes générées
    // depuis le logo (scripts/gen-icons.mjs). Uniquement sur l'app connectée.
    '<link rel="manifest" href="/manifest.webmanifest">',
    '<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">',
    '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-title" content="Stacker">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    ...PRELOAD_FONTS.map((f) => `<link rel="preload" href="/fonts/${f}" as="font" type="font/woff2" crossorigin>`),
    '<link rel="stylesheet" href="/src/styles/app.css">',
    '<script type="module" src="/src/entries/app.tsx"></script>',
  ];
  return `<!doctype html>
<html lang="fr">
<head>
${head.join('\n')}
</head>
<body class="grain">
${BOOT_SPLASH}
<div id="root"></div>
</body>
</html>
`;
}

export function writeTemplates() {
  for (const page of pages) writeFileSync(join(root, page.file), renderTemplate(page));
  writeFileSync(join(root, APP_FILE), renderAppTemplate());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) writeTemplates();
