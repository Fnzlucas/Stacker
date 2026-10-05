import { useCallback, useRef, useState, type ReactElement } from 'react';
import { Turnstile, type TurnstileHandle } from '../../components/Turnstile';
import { publicEnv } from '../../lib/env';

/**
 * Turnstile pour les formulaires d'authentification (même logique que la
 * liste d'attente) : Supabase Auth vérifie le jeton côté serveur (captcha
 * activé dans la configuration Auth). Sans clé de site (développement,
 * e2e), aucun widget n'est chargé et aucun jeton n'est envoyé.
 */
export interface Captcha {
  element: ReactElement | null;
  /** Jeton à joindre, `undefined` si le captcha est désactivé, `false` s'il manque encore. */
  token: () => string | undefined | false;
  missingMessage: () => string;
  reset: () => void;
}

export function useCaptcha(action: string): Captcha {
  const siteKey = publicEnv.turnstileSiteKey;
  const [token, setToken] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const ref = useRef<TurnstileHandle>(null);
  const onToken = useCallback((value: string | null) => {
    setToken(value);
    if (value) setUnavailable(false);
  }, []);
  const onError = useCallback(() => setUnavailable(true), []);

  return {
    element: siteKey ? <Turnstile ref={ref} siteKey={siteKey} action={action} onToken={onToken} onError={onError} /> : null,
    token: () => (siteKey ? (token ?? false) : undefined),
    missingMessage: () =>
      unavailable
        ? 'La vérification anti-robot n’a pas pu se charger. Désactive un éventuel bloqueur pour ce site, puis réessaie.'
        : 'La vérification anti-robot est en cours. Patiente une seconde puis réessaie.',
    // Un jeton Turnstile ne sert qu'une fois.
    reset: () => ref.current?.reset(),
  };
}
