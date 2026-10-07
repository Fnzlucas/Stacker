/**
 * Écran de démarrage de l'app connectée (#boot, dans app.html, hors de
 * #root). Il est peint et animé par le HTML et la CSS avant tout JavaScript ;
 * React ne le monte, ne le remplace ni ne le relance jamais. Ce module ne
 * fait qu'ajouter .is-leaving (sortie) puis retirer l'élément, dès que :
 *   - plus aucun écran d'attente n'est monté (<Splash /> = restauration de
 *     session, chargement d'un écran ou du profil) ;
 *   - ET l'animation d'entrée est terminée (animations CSS « boot-in-* »,
 *     ≈ 1,59 s depuis le premier rendu).
 * Aucun délai artificiel au-delà de l'animation d'entrée : si l'app est
 * prête plus tard, la sortie démarre aussitôt. En mouvement réduit, rien
 * n'est animé et la sortie est immédiate.
 */

const BOOT_ID = 'boot';
/** Préfixe des images clés d'entrée (src/styles/app.css). */
const ENTRY_PREFIX = 'boot-in-';
/** Durée de l'animation d'entrée (CSS : dernière lettre du wordmark, 1150 + 440 ms). */
export const ENTRY_MS = 1590;
/** Durée de la sortie (CSS : dernière bande, 160 + 360 ms). */
export const EXIT_MS = 520;
/** Élément dont la fin d'animation marque la fin de la sortie. */
const LAST_EXIT = '.boot-band-3';

let holds = 0;
let state: 'shown' | 'leaving' | 'gone' = 'shown';
let checkScheduled = false;
let waiting = false;

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Promesse résolue quand les animations d'entrée encore en cours sont finies. */
function entryFinished(el: HTMLElement): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  if (typeof el.getAnimations === 'function') {
    // Seules les animations d'ENTRÉE comptent (barres, tuile, reflet, lettres),
    // jamais la respiration, la barre de progression ni le message de lenteur.
    const running = el
      .getAnimations({ subtree: true })
      .filter((a) => (a as Partial<CSSAnimation>).animationName?.startsWith(ENTRY_PREFIX) && a.playState !== 'finished');
    return Promise.all(running.map((a) => a.finished.catch(() => undefined))).then(() => undefined);
  }
  // Repli (navigateur sans Web Animations) : temps écoulé depuis le premier rendu.
  const paint = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint');
  const left = (paint?.startTime ?? 0) + ENTRY_MS - performance.now();
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, left)));
}

function leave(el: HTMLElement): void {
  state = 'leaving';
  el.setAttribute('aria-hidden', 'true');
  el.removeAttribute('role');
  const remove = () => {
    if (state === 'gone') return;
    state = 'gone';
    el.remove();
  };
  if (reducedMotion()) {
    remove();
    return;
  }
  // Seule une classe est ajoutée : les animations de sortie sont posées sur
  // d'autres éléments que celles d'entrée, rien n'est relancé.
  el.classList.add('is-leaving');
  const last = el.querySelector(LAST_EXIT);
  el.addEventListener('animationend', (e) => e.target === last && remove());
  // Filet de sécurité si animationend ne vient pas (onglet en arrière-plan).
  setTimeout(remove, EXIT_MS + 200);
}

function check(): void {
  checkScheduled = false;
  if (state !== 'shown' || holds > 0 || waiting) return;
  const el = document.getElementById(BOOT_ID);
  if (!el) {
    state = 'gone';
    return;
  }
  waiting = true;
  void entryFinished(el).then(() => {
    waiting = false;
    // Un nouvel écran d'attente a pu apparaître pendant l'animation : on attend qu'il parte.
    if (state === 'shown' && holds === 0) leave(el);
  });
}

/** Demande la sortie de l'écran de démarrage si plus rien ne la retient (après le prochain rendu). */
export function scheduleBootCheck(): void {
  if (state !== 'shown' || checkScheduled) return;
  checkScheduled = true;
  requestAnimationFrame(check);
}

/** Retient l'écran de démarrage tant qu'un écran d'attente est monté. Renvoie la fonction de libération. */
export function holdBoot(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    scheduleBootCheck();
  };
}

/** Pour les tests unitaires. */
export function resetBootForTests(): void {
  holds = 0;
  state = 'shown';
  checkScheduled = false;
  waiting = false;
}
