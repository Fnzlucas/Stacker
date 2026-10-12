/**
 * Calculs du parallaxe des pages publiques (purs, testés). Le branchement
 * sur le DOM est dans src/islands/motion.ts.
 */

/** Vitesse lue dans data-parallax : nombre entre -1 et 1, 0 si invalide. */
export function parseSpeed(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

/**
 * Décalage vertical (px) d'un élément selon sa position dans la fenêtre :
 * 0 quand son centre est au centre de l'écran, borné à ±max.
 * Vitesse positive : l'élément monte plus vite que la page ; négative : il traîne.
 */
export function parallaxOffset(elementCenter: number, viewportHeight: number, speed: number, max = 120): number {
  const delta = elementCenter - viewportHeight / 2;
  const offset = -delta * speed;
  // « + 0 » : jamais de -0 (valeur CSS identique, comparaison plus simple).
  return Math.round(Math.max(-max, Math.min(max, offset)) * 10) / 10 + 0;
}

/** Délai d'apparition échelonné (ms) d'un élément dans sa liste, plafonné. */
export const revealDelay = (index: number, step = 80, cap = 400): number => Math.min(Math.max(0, index) * step, cap);
