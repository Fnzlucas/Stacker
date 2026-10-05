// Sert un build statique comme Vercel le fera : URLs propres (cleanUrls),
// sans « / » final, 404.html, redirections et EN-TÊTES lus dans vercel.json
// (CSP comprise). Les tests e2e tournent donc avec la vraie CSP.
//
//   node scripts/serve-dist.mjs [--dir=dist] [--port=4173]
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const dir = resolve(root, arg('dir') ?? 'dist');
const port = Number(arg('port') ?? process.env.PORT ?? 4173);
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Convertit une source Vercel simple (« /assets/(.*) ») en expression régulière. */
export function sourceToRegExp(source) {
  const parts = source.split('(.*)').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('(.*)')}$`);
}

const headerRules = (vercel.headers ?? []).map((r) => ({ re: sourceToRegExp(r.source), headers: r.headers }));
const redirects = (vercel.redirects ?? []).map((r) => ({ re: sourceToRegExp(r.source), ...r }));
// Comme Vercel : le système de fichiers d'abord, puis les rewrites (SPA /app/*).
const rewrites = (vercel.rewrites ?? []).map((r) => ({ re: sourceToRegExp(r.source), ...r }));

function headersFor(pathname) {
  const out = {};
  for (const rule of headerRules) if (rule.re.test(pathname)) for (const h of rule.headers) out[h.key] = h.value;
  // Seule différence avec Vercel : serveur local en HTTP, donc pas de mise à niveau forcée vers HTTPS.
  if (out['Content-Security-Policy']) out['Content-Security-Policy'] = out['Content-Security-Policy'].replace(/;\s*upgrade-insecure-requests/, '');
  delete out['Strict-Transport-Security'];
  return out;
}

function fileFor(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidates = clean === '/' ? ['index.html'] : [clean.slice(1), `${clean.slice(1)}.html`];
  for (const rel of candidates) {
    const abs = resolve(dir, rel);
    if (!abs.startsWith(dir + sep)) continue;
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return null;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const { pathname } = url;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  for (const r of redirects) {
    if (r.re.test(pathname)) {
      res.writeHead(r.permanent ? 308 : 307, { Location: r.destination }).end();
      return;
    }
  }
  // cleanUrls : /page.html → /page ; trailingSlash false : /page/ → /page
  if (pathname.endsWith('.html') || (pathname.length > 1 && pathname.endsWith('/'))) {
    const target = pathname.replace(/\/$/, '').replace(/(\/index)?\.html$/, '') || '/';
    res.writeHead(308, { Location: target + url.search }).end();
    return;
  }

  const rewrite = rewrites.find((r) => r.re.test(pathname));
  const file = fileFor(pathname) ?? (rewrite ? fileFor(rewrite.destination) : null);
  const status = file ? 200 : 404;
  const served = file ?? join(dir, '404.html');
  res.writeHead(status, {
    'Content-Type': TYPES[extname(served)] ?? 'application/octet-stream',
    ...headersFor(pathname),
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(served).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Site servi depuis ${dir} sur http://localhost:${String(port)}`);
});
