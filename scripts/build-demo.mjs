/**
 * Démo navigateur de l'app (données fictives, faux Supabase dans la page).
 * Produit dist-demo/site/ : index.html + app.js + fonts/, publiable tel quel.
 *   node scripts/build-demo.mjs
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

execFileSync('pnpm', ['exec', 'vite', 'build', '--config', 'vite.demo.config.ts'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_SUPABASE_URL: 'https://demo.supabase.co', VITE_SUPABASE_ANON_KEY: 'demo', VITE_TURNSTILE_SITE_KEY: '' },
});

const out = 'dist-demo/site';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const assets = readdirSync('dist-demo/assets');
const css = assets.find((f) => f.endsWith('.css'));
const js = assets.find((f) => f.endsWith('.js'));
if (!css || !js) throw new Error('build de démo incomplet');
const style = readFileSync(`dist-demo/assets/${css}`, 'utf8').replaceAll('url(/fonts/', 'url(fonts/');
cpSync(`dist-demo/assets/${js}`, `${out}/app.js`);
cpSync('public/fonts', `${out}/fonts`, { recursive: true });
writeFileSync(
  `${out}/index.html`,
  `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex" />
<title>Stacker app démo</title>
<style>${style}</style>
</head>
<body>
<div id="root"></div>
<script type="module" src="app.js"></script>
</body>
</html>
`,
);
console.log(`démo prête : ${out}/`);
