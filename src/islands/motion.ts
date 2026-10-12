/**
 * Mouvement au défilement des pages publiques :
 *   - [data-parallax="0.2"] : l'élément glisse à sa propre vitesse (propriété
 *     CSS `translate`, qui s'ajoute aux rotations existantes) ;
 *   - [data-reveal] : apparition douce à l'entrée dans l'écran, échelonnée
 *     dans une même liste.
 * Rien sans JavaScript ni avec « réduire les animations » : le contenu est
 * toujours visible. Les valeurs passent par le CSSOM (autorisé par la CSP).
 */
import { parallaxOffset, parseSpeed, revealDelay } from '../lib/motion';

export function initMotion(doc: Document = document): void {
  const view = doc.defaultView;
  if (!view || view.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in view)) return;
  const win: Window & typeof globalThis = view;
  doc.documentElement.classList.add('motion');

  // Apparition au défilement.
  const reveals = [...doc.querySelectorAll<HTMLElement>('[data-reveal]')];
  for (const el of reveals) {
    const siblings = el.parentElement ? [...el.parentElement.children].filter((c) => c.hasAttribute('data-reveal')) : [el];
    el.style.setProperty('--reveal-delay', `${String(revealDelay(siblings.indexOf(el)))}ms`);
  }
  const revealObserver = new win.IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-revealed');
        revealObserver.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
  );
  for (const el of reveals) revealObserver.observe(el);

  // Parallaxe : seuls les éléments proches de l'écran sont recalculés.
  const items = [...doc.querySelectorAll<HTMLElement>('[data-parallax]')].map((el) => ({ el, speed: parseSpeed(el.dataset['parallax']), applied: 0 }));
  if (items.length === 0) return;
  const visible = new Set<(typeof items)[number]>();
  const byEl = new Map(items.map((i) => [i.el, i]));
  const io = new win.IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const item = byEl.get(e.target as HTMLElement);
        if (!item) continue;
        if (e.isIntersecting) visible.add(item);
        else visible.delete(item);
      }
      schedule();
    },
    { rootMargin: '25% 0px' },
  );
  let frame = 0;
  const update = () => {
    frame = 0;
    const vh = win.innerHeight;
    // Sur téléphone, amplitude réduite : les éléments restent proches de leur place.
    const max = win.innerWidth < 768 ? 40 : 120;
    for (const item of visible) {
      const rect = item.el.getBoundingClientRect();
      // Position « au repos » : on retire le décalage déjà appliqué.
      const center = rect.top - item.applied + rect.height / 2;
      const offset = parallaxOffset(center, vh, item.speed, max);
      if (offset !== item.applied) {
        item.applied = offset;
        item.el.style.setProperty('--py', `${String(offset)}px`);
      }
    }
  };
  function schedule() {
    if (!frame) frame = win.requestAnimationFrame(update);
  }
  for (const item of items) io.observe(item.el);
  win.addEventListener('scroll', schedule, { passive: true });
  win.addEventListener('resize', schedule, { passive: true });
  schedule();
}
