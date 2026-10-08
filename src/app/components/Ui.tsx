import { useEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { formatRate, type Tier } from '../lib/tiers';

const TIER_ICON: Record<Tier['code'], IconName> = { rookie: 'graduation', pro: 'star', legend: 'flame', elite: 'trophy' };

export function LevelPill({ tier, className = '' }: { tier: Pick<Tier, 'code' | 'label' | 'rate_bps'>; className?: string }): ReactElement {
  return (
    <span className={`level level-${tier.code} ${className}`.trim()}>
      <span className="level-mark">
        <Icon name={TIER_ICON[tier.code]} />
      </span>
      {tier.label}
      <span className="level-rate">· {formatRate(tier.rate_bps)}</span>
    </span>
  );
}

/**
 * Barre de progression du design system. La largeur passe par une propriété
 * CSS posée via le CSSOM (React `style`), autorisé par la CSP (style-src
 * 'self' ne bloque que les attributs style du HTML).
 */
const PROGRESS_CLASS = { green: 'progress', violet: 'progress progress-violet', pink: 'progress progress-pink', orange: 'progress progress-orange' } as const;

export function ProgressBar({ percent, label, tone = 'violet' }: { percent: number; label: string; tone?: 'violet' | 'green' | 'pink' | 'orange' }): ReactElement {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const style = { '--value': `${String(value)}%` } as CSSProperties;
  return (
    <div className={PROGRESS_CLASS[tone]} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <span className="progress-bar" style={style} />
    </div>
  );
}

export function SoonBadge(): ReactElement {
  return <span className="sticker sticker-violet soon-sticker">Bientôt</span>;
}

export function SoonScreen({ icon, title, text, children }: { icon: IconName; title: string; text: ReactNode; children?: ReactNode }): ReactElement {
  return (
    <section className="card card-hero soon-card" aria-labelledby="soon-title">
      <div className="empty">
        <div className="empty-art">
          <div className="tile">
            <Icon name={icon} />
          </div>
          <span className="sticker sticker-violet">Bientôt</span>
        </div>
        <h2 id="soon-title" className="h3">
          {title}
        </h2>
        <p>{text}</p>
      </div>
      {children}
    </section>
  );
}

export function FeatureList({ items }: { items: { icon: IconName; title: string; text: string }[] }): ReactElement {
  return (
    <ul className="list feature-list">
      {items.map((item) => (
        <li key={item.title}>
          <div className="list-row">
            <span className="avatar avatar-violet" aria-hidden="true">
              <Icon name={item.icon} />
            </span>
            <div className="list-main">
              <span className="list-title">{item.title}</span>
              <span className="feature-text">{item.text}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Durée d'affichage d'un message de confirmation (il ne doit pas masquer l'écran). */
export const TOAST_MS = 5000;

export function Toast({ children, onClose }: { children: ReactNode; onClose: () => void }): ReactElement {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const timer = setTimeout(() => close.current(), TOAST_MS);
    return () => clearTimeout(timer);
  }, [children]);
  return (
    <div className="toast app-toast" role="status">
      <span className="toast-icon">
        <Icon name="check" />
      </span>
      <div className="toast-body">
        <strong>{children}</strong>
      </div>
      <button type="button" className="btn btn-ghost btn-icon" aria-label="Fermer" onClick={onClose}>
        <Icon name="x" />
      </button>
    </div>
  );
}
