import { useEffect, useImperativeHandle, useRef, type ReactElement, type Ref } from 'react';

/**
 * Widget Cloudflare Turnstile (rendu explicite). Le script n'est chargé que
 * lorsque le formulaire approche de l'écran, pour ne pas peser sur le
 * premier affichage. Autorisé par la CSP : script-src et frame-src
 * https://challenges.cloudflare.com.
 */
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileOptions {
  sitekey: string;
  action?: string;
  language?: string;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'flexible' | 'compact';
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
  'timeout-callback'?: () => void;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileOptions) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('turnstile indisponible'));
    });
    script.addEventListener('error', () => {
      scriptPromise = null;
      reject(new Error('turnstile non chargé'));
    });
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  reset: () => void;
}

export interface TurnstileProps {
  siteKey: string;
  action: string;
  onToken: (token: string | null) => void;
  onError: () => void;
  ref?: Ref<TurnstileHandle>;
}

export function Turnstile({ siteKey, action, onToken, onError, ref }: TurnstileProps): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const callbacks = useRef({ onToken, onError });

  useEffect(() => {
    callbacks.current = { onToken, onError };
  }, [onToken, onError]);

  useImperativeHandle(ref, () => ({
    reset: () => {
      callbacks.current.onToken(null);
      if (widgetId.current !== undefined) window.turnstile?.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    const el = container.current;
    if (!el) return undefined;
    let cancelled = false;

    const mount = () => {
      loadTurnstile()
        .then((api) => {
          if (cancelled || widgetId.current !== undefined) return;
          widgetId.current = api.render(el, {
            sitekey: siteKey,
            action,
            language: 'fr',
            theme: 'light',
            size: 'flexible',
            callback: (token) => callbacks.current.onToken(token),
            'expired-callback': () => callbacks.current.onToken(null),
            'timeout-callback': () => callbacks.current.onToken(null),
            'error-callback': () => {
              callbacks.current.onToken(null);
              callbacks.current.onError();
            },
          });
        })
        .catch(() => {
          if (!cancelled) callbacks.current.onError();
        });
    };

    let observer: IntersectionObserver | null = null;
    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            observer?.disconnect();
            mount();
          }
        },
        { rootMargin: '400px 0px' },
      );
      observer.observe(el);
    } else {
      mount();
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (widgetId.current !== undefined) window.turnstile?.remove(widgetId.current);
      widgetId.current = undefined;
    };
  }, [siteKey, action]);

  return <div ref={container} className="turnstile-slot" />;
}
