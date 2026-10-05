/* ==========================================================================
   Stacker — Helpers UI (sans dépendance) pour les composants interactifs.
   ========================================================================== */
import { icon } from './icons.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Titre ransom accessible : lecteurs d'écran lisent le texte entier. */
export function ransomHTML(text, { size = '', animated = true } = {}) {
  let i = 0;
  const words = text.trim().split(/\s+/).map((w) =>
    `<span class="w" aria-hidden="true">${[...w].map((ch) => `<span class="l rc${i % 6}" style="--i:${i++}">${esc(ch)}</span>`).join('')}</span>`
  ).join('');
  const cls = ['ransom', size && `ransom-${size}`, animated && 'is-animated'].filter(Boolean).join(' ');
  return `<span class="${cls}"><span class="sr-only">${esc(text)}</span>${words}</span>`;
}

/** Toast éphémère. type : success | error | info */
export function toast(title, { text = '', type = 'success', duration = 3600 } = {}) {
  const map = { success: 'check', error: 'alert', info: 'info' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="toast-icon">${icon(map[type])}</span>
    <div class="toast-body"><strong>${esc(title)}</strong>${text ? `<span>${esc(text)}</span>` : ''}</div>
    <button class="btn btn-ghost btn-icon" aria-label="Fermer">${icon('x')}</button>`;
  const close = () => el.remove();
  el.querySelector('button').addEventListener('click', close);
  document.body.appendChild(el);
  if (duration) setTimeout(close, duration);
  return close;
}

/** Bottom sheet : <div class="sheet-backdrop" data-sheet-backdrop="id"> + <div class="sheet" id="id" role="dialog" aria-modal="true"> */
export function openSheet(id) {
  const sheet = document.getElementById(id);
  const backdrop = document.querySelector(`[data-sheet-backdrop="${id}"]`);
  if (!sheet) return;
  const opener = document.activeElement;
  sheet.classList.add('is-open');
  backdrop?.classList.add('is-open');
  sheet.removeAttribute('inert');
  const focusable = sheet.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  focusable?.focus();
  const close = () => {
    sheet.classList.remove('is-open');
    backdrop?.classList.remove('is-open');
    sheet.setAttribute('inert', '');
    document.removeEventListener('keydown', onKey);
    opener?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop?.addEventListener('click', close, { once: true });
  sheet.querySelectorAll('[data-sheet-close]').forEach((b) => b.addEventListener('click', close, { once: true }));
  return close;
}

/** Formatage monétaire FR : 1 248,50 € → { euros: '1 248', cents: ',50 €' } */
export function splitEuros(value) {
  const s = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
  const m = s.match(/^(.*?)(,\d{2}\s?€)$/);
  return m ? { euros: m[1], cents: m[2] } : { euros: s, cents: '' };
}
