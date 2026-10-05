// Génère showcase.html (autonome : CSS + SVG inlinés, polices en ./fonts) et favicon.svg
// Usage : node design/build-showcase.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { icon, ICON_NAMES } from './icons.js';
import { logoSVG, logoLockup, faviconSVG, faviconDataURL } from './logo.js';
import { ransomHTML } from './ui.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(dir, f), 'utf8');

const css = ['fonts.css', 'tokens.css', 'components.css'].map(read).join('\n');

const TABS = [
  ['home', 'home', 'Accueil'],
  ['prospects', 'users', 'Prospects'],
  ['deals', 'briefcase', 'Deals'],
  ['gains', 'wallet', 'Gains'],
  ['profil', 'user', 'Profil'],
];
const tabbar = (active) =>
  `<nav class="tabbar is-contained" aria-label="Navigation principale">${TABS.map(
    ([id, ic, label]) =>
      `<a class="tabbar-item" href="#"${id === active ? ' aria-current="page"' : ''}><span class="tabbar-icon">${icon(ic)}</span>${label}</a>`
  ).join('')}</nav>`;

const iconGrid = ICON_NAMES.map((n) => `<figure>${icon(n)}<figcaption>${n}</figcaption></figure>`).join('');

let html = read('showcase.src.html')
  .replace('{{css}}', () => css)
  .replace('{{favicon}}', faviconDataURL())
  .replace('{{iconGrid}}', iconGrid)
  .replace(/\{\{icon:([\w-]+)(?::(\d+))?(?::([\w-]+))?\}\}/g, (_, n, s, c) => icon(n, { size: s ? +s : 24, className: c || '' }))
  .replace(/\{\{logo:(\d+)\}\}/g, (_, s) => logoSVG({ size: +s, title: 'Stacker' }))
  .replace(/\{\{bars:(\d+)\}\}/g, (_, s) => logoSVG({ size: +s, tile: false }))
  .replace(/\{\{lockup:(\d+)\}\}/g, (_, s) => logoLockup({ size: +s }))
  .replace(/\{\{lockup-inv:(\d+)\}\}/g, (_, s) => logoLockup({ size: +s, inverse: true }))
  .replace(/\{\{ransom:([^}]+)\}\}/g, (_, t) => ransomHTML(t, { animated: false }))
  .replace(/\{\{tabbar:(\w+)\}\}/g, (_, a) => tabbar(a));

const left = html.match(/\{\{[^}]+\}\}/g);
if (left) throw new Error('Jetons non remplacés : ' + left.join(', '));

writeFileSync(join(dir, 'showcase.html'), html);
writeFileSync(join(dir, 'favicon.svg'), faviconSVG());
console.log('showcase.html', (html.length / 1024).toFixed(1) + ' Ko');
