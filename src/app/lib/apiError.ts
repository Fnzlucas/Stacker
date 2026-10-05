/** Erreur d'API typée (module sans dépendance : chargé dès le démarrage). */
export type ApiErrorKind = 'network' | 'invalid' | 'forbidden' | 'unauthorized' | 'reauth_required' | 'rate_limited' | 'server';

export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'ApiError';
  }
}

