// Budget de poids (DoD §6 critère 9) : JS initial ≤ 170 Ko gzip par page,
// CSS ≤ 40 Ko gzip. Mesure le JS réellement chargé par chaque page HTML du
// build (script d'entrée + modulepreload).
//
//   node scripts/check-bundle-size.mjs [--dir=dist]
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, process.argv.find((a) => a.startsWith('--dir='))?.slice(6) ?? 'dist');

export const BUDGET = { jsPerPage: 170 * 1024, cssPerPage: 40 * 1024 };

const gz = (rel) => gzipSync(readFileSync(join(dir, rel.replace(/^\//, '')))).length;
const kb = (n) => `${(n / 1024).toFixed(1)} Ko`;

let failed = false;
const rows = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(join(dir, file), 'utf8');
  const js = new Set([...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g), ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map((m) => m[1]));
  const css = new Set([...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]));
  const jsSize = [...js].reduce((n, f) => n + gz(f), 0);
  const cssSize = [...css].reduce((n, f) => n + gz(f), 0);
  const ok = jsSize <= BUDGET.jsPerPage && cssSize <= BUDGET.cssPerPage;
  if (!ok) failed = true;
  rows.push(`${ok ? '✓' : '✗'} ${file.padEnd(24)} JS ${kb(jsSize).padStart(9)}   CSS ${kb(cssSize).padStart(8)}`);
}
console.log(rows.join('\n'));
console.log(`Budget : JS ${kb(BUDGET.jsPerPage)} gzip, CSS ${kb(BUDGET.cssPerPage)} gzip par page`);
if (failed) {
  console.error('✗ Budget de poids dépassé');
  process.exit(1);
}
