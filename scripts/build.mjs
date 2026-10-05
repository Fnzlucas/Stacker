// Build de production : site statique avec pages publiques pré-rendues.
//
//   1. gabarits HTML depuis src/site/pages.json (scripts/gen-html.mjs) ;
//   2. build SSR de src/ssr/render.tsx (Node, dans .ssr/) ;
//   3. build client Vite (JS des îlots, CSS, polices) ;
//   4. injection du HTML pré-rendu dans chaque page, URL publique,
//      sitemap.xml et robots.txt ;
//   5. contrôle des jetons {{À COMPLÉTER}} / {{À VÉRIFIER}} : listés, et
//      bloquants pour un déploiement de production Vercel.
//
// Options : --outDir=<dossier> (défaut : dist). Variables : SITE_URL,
// VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_TURNSTILE_SITE_KEY
// (lues aussi depuis .env), ALLOW_PLACEHOLDERS=1 pour forcer.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, loadEnv } from 'vite';
import { APP_FILE, pages, writeTemplates } from './gen-html.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const outDir = resolve(root, arg('outDir') ?? 'dist');
const ssrDir = resolve(root, '.ssr', String(process.pid));

const fileEnv = loadEnv('production', root, '');
const env = (name) => process.env[name] ?? fileEnv[name] ?? '';

function siteUrl() {
  const explicit = env('SITE_URL');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '';
  const raw = explicit || vercel || 'http://localhost:4173';
  const url = new URL(raw);
  return url.origin;
}

const MARKERS = /\{\{À (COMPLÉTER|VÉRIFIER) : ([^}]*)\}\}/g;

async function main() {
  const started = Date.now();
  const site = siteUrl();
  writeTemplates();

  await build({ root, logLevel: 'warn', build: { ssr: 'src/ssr/render.tsx', outDir: ssrDir, emptyOutDir: true } });
  await build({ root, logLevel: 'warn', build: { outDir, emptyOutDir: true } });

  const { renderPage } = await import(pathToFileURL(join(ssrDir, 'render.js')).href);
  const todos = new Map();

  for (const page of pages) {
    const file = join(outDir, page.file);
    const template = readFileSync(file, 'utf8');
    if (!template.includes('<!--ssr-outlet-->')) throw new Error(`${page.file} : emplacement <!--ssr-outlet--> introuvable`);
    const html = template.replace('<!--ssr-outlet-->', () => renderPage(page.id)).replaceAll('%%SITE_URL%%', site);
    if (/\sstyle="/.test(html)) throw new Error(`${page.file} : attribut style interdit par la CSP`);
    for (const m of html.matchAll(MARKERS)) {
      const key = `${m[1]} : ${m[2]}`;
      todos.set(key, (todos.get(key) ?? new Set()).add(page.path));
    }
    writeFileSync(file, html);
  }

  // Application connectée : aucun pré-rendu, mêmes contrôles CSP.
  const appHtml = readFileSync(join(outDir, APP_FILE), 'utf8');
  if (/\sstyle="/.test(appHtml) || /<script(?![^>]*\bsrc=)[^>]*>/.test(appHtml)) throw new Error(`${APP_FILE} : style ou script inline interdit par la CSP`);

  const urls = pages.filter((p) => p.sitemap).map((p) => `  <url><loc>${site}${p.path === '/' ? '/' : p.path}</loc></url>`);
  writeFileSync(
    join(outDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
  );
  writeFileSync(join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /app\n\nSitemap: ${site}/sitemap.xml\n`);

  rmSync(ssrDir, { recursive: true, force: true });
  for (const file of [...pages.map((p) => p.file), APP_FILE]) if (existsSync(join(root, file))) rmSync(join(root, file));

  const configured = Boolean(env('VITE_SUPABASE_URL') && env('VITE_SUPABASE_ANON_KEY'));
  console.log(`✓ build : ${String(pages.length)} pages pré-rendues dans ${outDir} (${String(Date.now() - started)} ms)`);
  console.log(`  SITE_URL = ${site}`);
  console.log(`  Supabase : ${configured ? 'configuré' : 'NON configuré (formulaire désactivé avec un message)'}`);
  console.log(`  Turnstile : ${env('VITE_TURNSTILE_SITE_KEY') ? 'activé' : 'désactivé'}`);

  // Production : le formulaire ne peut pas partir sans anti-robot, et les URLs
  // publiques (canonical, sitemap, liens de parrainage) doivent être en HTTPS.
  if (process.env.VERCEL_ENV === 'production') {
    const blockers = [];
    if (configured && !env('VITE_TURNSTILE_SITE_KEY')) blockers.push('VITE_TURNSTILE_SITE_KEY absent alors que Supabase est configuré');
    if (!site.startsWith('https://') || /localhost|127\.0\.0\.1/.test(site)) blockers.push(`SITE_URL invalide pour la production : ${site}`);
    if (blockers.length > 0) {
      for (const b of blockers) console.error(`✗ ${b}`);
      console.error('✗ Déploiement de production refusé.');
      process.exit(1);
    }
  }

  if (todos.size > 0) {
    console.log(`⚠ ${String(todos.size)} information(s) à compléter ou vérifier avant la production :`);
    for (const [key, where] of todos) console.log(`  - ${key}  (${[...where].join(', ')})`);
    if (process.env.VERCEL_ENV === 'production' && process.env.ALLOW_PLACEHOLDERS !== '1') {
      console.error('✗ Déploiement de production refusé : complète src/config/site.ts (ou ALLOW_PLACEHOLDERS=1 en connaissance de cause).');
      process.exit(1);
    }
  }
}

main().catch((error) => {
  rmSync(ssrDir, { recursive: true, force: true });
  console.error(error);
  process.exit(1);
});
