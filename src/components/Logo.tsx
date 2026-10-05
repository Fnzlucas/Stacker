import { useId, type ReactElement } from 'react';
import { LOGO_COLORS } from '../../design/logo.js';

/** Port React de design/logo.js (même géométrie : tuile 23 %, barres 58 % × 12,5 %, écart 6 %). */
const S = 100;
const r2 = (n: number) => Math.round(n * 100) / 100;
const RX = S * 0.23;
const BW = S * 0.58;
const BH = S * 0.125;
const GAP = S * 0.06;
const BX = (S - BW) / 2;
const BY = (S - (BH * 3 + GAP * 2)) / 2;

export interface LogoProps {
  size?: number;
  /** false = barres seules (filigrane sur fond sombre). */
  tile?: boolean;
  title?: string;
  className?: string;
}

export function Logo({ size = 48, tile = true, title, className }: LogoProps): ReactElement {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const a11y = title ? { role: 'img', 'aria-labelledby': `${id}t` } : { 'aria-hidden': true, focusable: 'false' as const };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${String(S)} ${String(S)}`} width={size} height={size} className={className} {...a11y}>
      {title ? <title id={`${id}t`}>{title}</title> : null}
      {tile ? (
        <>
          <defs>
            <linearGradient id={`${id}g`} x1=".33" y1=".03" x2=".67" y2=".97">
              <stop offset="0" stopColor={LOGO_COLORS.tileFrom} />
              <stop offset="1" stopColor={LOGO_COLORS.tileTo} />
            </linearGradient>
            <linearGradient id={`${id}h`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".16" />
              <stop offset=".45" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect width={S} height={S} rx={RX} fill={`url(#${id}g)`} />
          <rect x=".75" y=".75" width={S - 1.5} height={S - 1.5} rx={RX - 0.75} fill={`url(#${id}h)`} stroke="#fff" strokeOpacity=".09" strokeWidth="1.5" />
        </>
      ) : null}
      {LOGO_COLORS.bars.map((color, i) => (
        <rect key={color} x={r2(BX)} y={r2(BY + i * (BH + GAP))} width={r2(BW)} height={r2(BH)} rx={r2(BH / 2)} fill={color} />
      ))}
    </svg>
  );
}

export function LogoLockup({ size = 34, inverse = false }: { size?: number; inverse?: boolean }): ReactElement {
  return (
    <span className={`logo-lockup${inverse ? ' is-inverse' : ''} logo-size-${String(size)}`}>
      <Logo size={size} />
      <span className="wordmark">Stacker</span>
    </span>
  );
}
