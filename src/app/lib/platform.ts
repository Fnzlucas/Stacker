/**
 * Où tourne l'app : application iPhone (Capacitor), app installée sur
 * l'écran d'accueil (PWA) ou navigateur. Sert à :
 *   - proposer l'installation sur iPhone depuis Safari ;
 *   - masquer, dans l'application iPhone, tout prix et tout lien de paiement
 *     (règles de l'App Store : l'abonnement se prend sur le site).
 */

interface CapacitorLike {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

export interface PlatformEnv {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  capacitor: CapacitorLike | undefined;
}

export function currentEnv(): PlatformEnv {
  if (typeof window === 'undefined') return { userAgent: '', maxTouchPoints: 0, standalone: false, capacitor: undefined };
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const displayStandalone = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints,
    standalone: nav.standalone === true || displayStandalone,
    capacitor: (window as Window & { Capacitor?: CapacitorLike }).Capacitor,
  };
}

/** Application iPhone / Android (Capacitor). */
export function isNativeApp(env: PlatformEnv = currentEnv()): boolean {
  try {
    return env.capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** iPhone ou iPad (y compris l'iPad qui se présente comme un Mac). */
export function isIos(env: PlatformEnv = currentEnv()): boolean {
  return /iPhone|iPad|iPod/.test(env.userAgent) || (env.userAgent.includes('Macintosh') && env.maxTouchPoints > 1);
}

/** Safari sur iPhone, hors app installée : on peut proposer « Sur l'écran d'accueil ». */
export function canSuggestIosInstall(env: PlatformEnv = currentEnv()): boolean {
  if (!isIos(env) || env.standalone || isNativeApp(env)) return false;
  // Chrome, Firefox, Edge… sur iOS ne savent pas toujours ajouter à l'écran d'accueil : Safari seulement.
  return env.userAgent.includes('Safari/') && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(env.userAgent);
}
