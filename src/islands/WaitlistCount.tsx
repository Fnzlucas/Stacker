import { useEffect, useState, type ReactElement } from 'react';
import { getWaitlistCountOnce } from '../lib/api';
import { publicEnv } from '../lib/env';
import { waitlistCountLabel } from '../lib/format';

export type WaitlistCountVariant = 'pill' | 'dark';

/**
 * Compteur RÉEL des inscrits (RPC waitlist_count, qui ne renvoie qu'un
 * entier agrégé). Pendant le chargement : un squelette. En cas d'échec ou si
 * Supabase n'est pas configuré : rien. Jamais de chiffre inventé ni arrondi.
 */
export function WaitlistCount({ variant }: { variant: WaitlistCountVariant }): ReactElement | null {
  const [count, setCount] = useState<number | null | 'loading'>('loading');

  useEffect(() => {
    let alive = true;
    void getWaitlistCountOnce(publicEnv).then((value) => {
      if (alive) setCount(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (count === null) return null;

  const cls = variant === 'pill' ? 'chip chip-outline count-pill' : 'count-dark';

  if (count === 'loading') {
    return (
      <span className={cls} aria-hidden="true">
        <span className="live-dot" />
        <span className="skeleton skeleton-text count-skeleton" />
      </span>
    );
  }

  const { strong, rest } = waitlistCountLabel(count);
  return (
    <span className={cls} data-testid="waitlist-count">
      <span className="live-dot" aria-hidden="true" />
      <span>
        {strong ? <b className="num">{strong}</b> : null}
        {rest}
      </span>
    </span>
  );
}
