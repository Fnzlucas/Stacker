/**
 * Messages d'erreur d'authentification, en français, qui ne révèlent JAMAIS
 * si une adresse a un compte (pas d'énumération) :
 *   - inscription avec une adresse déjà utilisée → même écran « vérifie ta
 *     boîte mail » qu'une inscription normale ;
 *   - mot de passe oublié, code de connexion → même confirmation neutre ;
 *   - connexion → « email ou mot de passe incorrect », sans distinguer.
 */
export type AuthContext = 'signup' | 'login' | 'recover' | 'otp_request' | 'otp_verify' | 'link_verify' | 'update_password' | 'resend' | 'reauth';

export interface AuthErrorLike {
  code?: string | undefined;
  status?: number | undefined;
  name?: string | undefined;
  message?: string | undefined;
  reasons?: readonly string[] | undefined;
}

/** Résultat : message à afficher, ou `neutral` = faire comme si tout allait bien. */
export type AuthErrorOutcome = { kind: 'message'; message: string; field?: 'email' | 'password' | 'code' } | { kind: 'neutral' };

const RATE_LIMIT_CODES = new Set(['over_email_send_rate_limit', 'over_request_rate_limit', 'over_sms_send_rate_limit']);
// Codes qui trahiraient l'existence (ou non) d'un compte : traités comme un succès.
const ENUMERATION_CODES = new Set(['user_already_exists', 'email_exists', 'user_not_found', 'otp_disabled', 'signup_disabled_for_otp']);

const msg = (message: string, field?: 'email' | 'password' | 'code'): AuthErrorOutcome => (field ? { kind: 'message', message, field } : { kind: 'message', message });

export function authErrorOutcome(error: AuthErrorLike, context: AuthContext): AuthErrorOutcome {
  const code = error.code ?? '';
  const network = error.name === 'AuthRetryableFetchError' && (error.status ?? 0) === 0;

  if (network) return msg('Connexion impossible. Vérifie ta connexion internet et réessaie.');
  if (code === 'captcha_failed') return msg('La vérification anti-robot a échoué. Réessaie.');
  if (RATE_LIMIT_CODES.has(code) || error.status === 429) return msg('Trop de tentatives. Patiente quelques minutes avant de réessayer.');

  if (ENUMERATION_CODES.has(code) && (context === 'signup' || context === 'recover' || context === 'otp_request' || context === 'resend')) {
    return { kind: 'neutral' };
  }

  switch (code) {
    case 'invalid_credentials':
      return msg('Email ou mot de passe incorrect.', 'password');
    case 'email_not_confirmed':
      return msg('Ton adresse email n’est pas encore confirmée. Ouvre l’email de confirmation que nous t’avons envoyé, ou demande-en un nouveau.');
    case 'weak_password':
      return error.reasons?.includes('pwned')
        ? msg('Ce mot de passe apparaît dans des fuites de données connues. Choisis-en un autre.', 'password')
        : msg('Mot de passe trop faible : 12 caractères minimum, avec une minuscule, une majuscule et un chiffre.', 'password');
    case 'same_password':
      return msg('Choisis un mot de passe différent de l’ancien.', 'password');
    case 'otp_expired':
      return context === 'otp_verify' || context === 'reauth'
        ? msg('Code incorrect ou expiré. Vérifie-le ou demande-en un nouveau.', 'code')
        : msg('Ce lien a expiré ou a déjà servi. Demande-en un nouveau.');
    case 'signup_disabled':
    case 'email_provider_disabled':
      return msg('Les inscriptions ne sont pas encore ouvertes. Reviens un peu plus tard.');
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
      return msg('Ta session a expiré. Reconnecte-toi.');
    case 'reauthentication_needed':
      return msg('Pour des raisons de sécurité, reconnecte-toi puis réessaie.');
    case 'validation_failed':
      return msg('Certains champs sont invalides. Vérifie ta saisie.');
    case 'user_banned':
      // Message volontairement générique (ne confirme pas l'état du compte).
      return msg('Connexion impossible. Contacte le support si le problème persiste.');
    default:
      if (context === 'login') return msg('Email ou mot de passe incorrect.', 'password');
      return msg('Le service est momentanément indisponible. Réessaie dans un instant.');
  }
}
