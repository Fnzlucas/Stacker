import { describe, expect, it } from 'vitest';
import { authErrorOutcome } from './authErrors';

describe('messages d’erreur d’authentification', () => {
  it('erreur réseau', () => {
    expect(authErrorOutcome({ name: 'AuthRetryableFetchError', status: 0 }, 'login')).toEqual({ kind: 'message', message: 'Connexion impossible. Vérifie ta connexion internet et réessaie.' });
  });
  it('erreur serveur 5xx (réessayable) : message générique, pas « réseau »', () => {
    expect(authErrorOutcome({ name: 'AuthRetryableFetchError', status: 503 }, 'signup')).toEqual({
      kind: 'message',
      message: 'Le service est momentanément indisponible. Réessaie dans un instant.',
    });
  });
  it('captcha et limites de débit', () => {
    expect(authErrorOutcome({ code: 'captcha_failed' }, 'signup')).toMatchObject({ message: 'La vérification anti-robot a échoué. Réessaie.' });
    expect(authErrorOutcome({ code: 'over_email_send_rate_limit' }, 'recover')).toMatchObject({ message: expect.stringContaining('Trop de tentatives') });
    expect(authErrorOutcome({ status: 429 }, 'login')).toMatchObject({ message: expect.stringContaining('Trop de tentatives') });
  });
  it('aucune énumération de comptes', () => {
    for (const ctx of ['signup', 'recover', 'otp_request', 'resend'] as const) {
      expect(authErrorOutcome({ code: 'user_already_exists' }, ctx)).toEqual({ kind: 'neutral' });
      expect(authErrorOutcome({ code: 'otp_disabled' }, ctx)).toEqual({ kind: 'neutral' });
      expect(authErrorOutcome({ code: 'user_not_found' }, ctx)).toEqual({ kind: 'neutral' });
    }
    // En connexion, un compte inconnu et un mauvais mot de passe donnent le même message.
    const unknown = authErrorOutcome({ code: 'user_not_found' }, 'login');
    const wrong = authErrorOutcome({ code: 'invalid_credentials' }, 'login');
    expect(unknown).toEqual(wrong);
    expect(wrong).toEqual({ kind: 'message', message: 'Email ou mot de passe incorrect.', field: 'password' });
  });
  it('mot de passe faible ou ayant fuité', () => {
    expect(authErrorOutcome({ code: 'weak_password', reasons: ['pwned'] }, 'signup')).toMatchObject({ field: 'password', message: expect.stringContaining('fuites de données') });
    expect(authErrorOutcome({ code: 'weak_password', reasons: ['length'] }, 'signup')).toMatchObject({ message: expect.stringContaining('12 caractères') });
    expect(authErrorOutcome({ code: 'weak_password' }, 'update_password')).toMatchObject({ message: expect.stringContaining('12 caractères') });
    expect(authErrorOutcome({ code: 'same_password' }, 'update_password')).toMatchObject({ field: 'password' });
  });
  it('codes et liens expirés', () => {
    expect(authErrorOutcome({ code: 'otp_expired' }, 'otp_verify')).toMatchObject({ field: 'code' });
    expect(authErrorOutcome({ code: 'otp_expired' }, 'reauth')).toMatchObject({ field: 'code' });
    expect(authErrorOutcome({ code: 'otp_expired' }, 'link_verify')).toMatchObject({ message: 'Ce lien a expiré ou a déjà servi. Demande-en un nouveau.' });
  });
  it('autres cas connus', () => {
    expect(authErrorOutcome({ code: 'email_not_confirmed' }, 'login')).toMatchObject({ message: expect.stringContaining('pas encore confirmée') });
    expect(authErrorOutcome({ code: 'signup_disabled' }, 'signup')).toMatchObject({ message: expect.stringContaining('pas encore ouvertes') });
    expect(authErrorOutcome({ code: 'email_provider_disabled' }, 'signup')).toMatchObject({ message: expect.stringContaining('pas encore ouvertes') });
    for (const code of ['session_not_found', 'session_expired', 'refresh_token_not_found', 'refresh_token_already_used']) {
      expect(authErrorOutcome({ code }, 'update_password')).toMatchObject({ message: 'Ta session a expiré. Reconnecte-toi.' });
    }
    expect(authErrorOutcome({ code: 'reauthentication_needed' }, 'update_password')).toMatchObject({ message: expect.stringContaining('reconnecte-toi') });
    expect(authErrorOutcome({ code: 'validation_failed' }, 'signup')).toMatchObject({ message: expect.stringContaining('invalides') });
    expect(authErrorOutcome({ code: 'user_banned' }, 'login')).toMatchObject({ message: expect.stringContaining('Contacte le support') });
  });
  it('code inconnu : générique (connexion : identifiants)', () => {
    expect(authErrorOutcome({ code: 'nouveau_code' }, 'signup')).toMatchObject({ message: expect.stringContaining('momentanément indisponible') });
    expect(authErrorOutcome({}, 'login')).toMatchObject({ message: 'Email ou mot de passe incorrect.' });
  });
});
