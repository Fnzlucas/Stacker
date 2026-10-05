/* ==========================================================================
   Stacker — Logo (tuile + 3 barres) en SVG, à n'importe quelle taille.
   Géométrie (en % du côté) :
     tuile   radius 23 %, dégradé 160° #2a2a33 → #0a0a0e, reflet inset
     barres  largeur 58 %, hauteur 12,5 %, espacement 6 %, centrées
             haut → bas : vert #3ccf63, violet #7b7bf0, orange #f7a21b
   Usage :
     import { logoSVG, logoLockup, faviconSVG, injectFavicon } from './logo.js'
     el.innerHTML = logoSVG({ size: 48 })
   ========================================================================== */

export const LOGO_COLORS = Object.freeze({
  tileFrom: '#2a2a33',
  tileTo: '#0a0a0e',
  bars: ['#3ccf63', '#7b7bf0', '#f7a21b'],
});

let uid = 0;
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object}  [o]
 * @param {number}  [o.size=48]      côté en px
 * @param {boolean} [o.tile=true]    false = barres seules (sur fond sombre)
 * @param {string}  [o.title]        titre accessible ; absent = décoratif
 * @param {string}  [o.className]
 * @returns {string} balise <svg>
 */
export function logoSVG({ size = 48, tile = true, title, className = '' } = {}) {
  const S = 100; // viewBox fixe, rendu net à toute taille
  const id = `stl${++uid}`;
  const rx = S * 0.23;
  const bw = S * 0.58, bh = S * 0.125, gap = S * 0.06;
  const bx = (S - bw) / 2;
  const by = (S - (bh * 3 + gap * 2)) / 2;

  const bars = LOGO_COLORS.bars
    .map((c, i) => `<rect x="${r2(bx)}" y="${r2(by + i * (bh + gap))}" width="${r2(bw)}" height="${r2(bh)}" rx="${r2(bh / 2)}" fill="${c}"/>`)
    .join('');

  const a11y = title
    ? `role="img" aria-labelledby="${id}t"><title id="${id}t">${title}</title>`
    : `aria-hidden="true" focusable="false">`;

  const tileMarkup = tile
    ? `<defs>
<linearGradient id="${id}g" x1=".33" y1=".03" x2=".67" y2=".97"><stop offset="0" stop-color="${LOGO_COLORS.tileFrom}"/><stop offset="1" stop-color="${LOGO_COLORS.tileTo}"/></linearGradient>
<linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<rect width="${S}" height="${S}" rx="${rx}" fill="url(#${id}g)"/>
<rect x=".75" y=".75" width="${S - 1.5}" height="${S - 1.5}" rx="${rx - 0.75}" fill="url(#${id}h)" stroke="#fff" stroke-opacity=".09" stroke-width="1.5"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${size}" height="${size}"${className ? ` class="${className}"` : ''} ${a11y}${tileMarkup}${bars}</svg>`;
}

/**
 * Logo + wordmark « Stacker » (Inter Display 800, tracking -0.055em).
 * Le wordmark mesure ~0.62 × la tuile. Classes : .logo-lockup / .wordmark
 */
export function logoLockup({ size = 40, inverse = false, className = '' } = {}) {
  return `<span class="logo-lockup${inverse ? ' is-inverse' : ''}${className ? ' ' + className : ''}" style="--logo-size:${size}px">${logoSVG({ size })}<span class="wordmark">Stacker</span></span>`;
}

/** Favicon SVG autonome (64 px, sans dépendance). */
export function faviconSVG() {
  return logoSVG({ size: 64, title: 'Stacker' });
}

export function faviconDataURL() {
  return `data:image/svg+xml,${encodeURIComponent(faviconSVG())}`;
}

/** Ajoute/remplace <link rel="icon"> dans le document courant. */
export function injectFavicon(doc = globalThis.document) {
  if (!doc) return;
  let link = doc.querySelector('link[rel="icon"]');
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'icon';
    doc.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = faviconDataURL();
}
