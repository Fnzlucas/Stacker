/** Routes de l'app connectée (préfixe /app, servi par app.html). */
export const PATHS = {
  home: '/app',
  prospects: '/app/prospects',
  deals: '/app/deals',
  gains: '/app/gains',
  profile: '/app/profil',
  onboarding: '/app/bienvenue',
  login: '/app/connexion',
  loginCode: '/app/connexion/code',
  signup: '/app/inscription',
  verifyEmail: '/app/verifier-email',
  confirm: '/app/auth/confirmer',
  forgot: '/app/mot-de-passe-oublie',
  newPassword: '/app/nouveau-mot-de-passe',
  logout: '/app/deconnexion',
  deleted: '/app/compte-supprime',
} as const;

/** Page demandée avant la connexion (uniquement un chemin interne de l'app). */
export function safeReturnPath(state: unknown): string {
  const from = state && typeof state === 'object' && 'from' in state ? state.from : null;
  return typeof from === 'string' && /^\/app(\/[a-z-]+)*$/.test(from) ? from : PATHS.home;
}
