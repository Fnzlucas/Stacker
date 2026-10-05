import { createElement, type ReactElement } from 'react';
import { ICONS } from '../../design/icons.js';

/**
 * Port React des icônes du design system (design/icons.js), sans
 * dangerouslySetInnerHTML : les tracés SVG (source de confiance, figée)
 * sont convertis une seule fois en éléments React.
 */
export type IconName = keyof typeof ICONS;

const TAG_RE = /<(path|circle|rect|line|polyline|polygon|ellipse)\s([^>]*?)\/>/g;
const ATTR_RE = /([a-z][a-z-]*)="([^"]*)"/g;
const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

type Shape = { tag: string; attrs: Record<string, string> };

const cache = new Map<IconName, Shape[]>();

function shapes(name: IconName): Shape[] {
  const hit = cache.get(name);
  if (hit) return hit;
  const out: Shape[] = [];
  for (const [, tag, rawAttrs] of ICONS[name].matchAll(TAG_RE)) {
    const attrs: Record<string, string> = {};
    for (const [, key, value] of (rawAttrs ?? '').matchAll(ATTR_RE)) attrs[camel(key ?? '')] = value ?? '';
    out.push({ tag: tag ?? 'path', attrs });
  }
  cache.set(name, out);
  return out;
}

export interface IconProps {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
  /** Libellé accessible ; absent = icône décorative (aria-hidden). */
  label?: string;
}

export function Icon({ name, size = 24, stroke = 2.25, className, label }: IconProps): ReactElement {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: 'false' as const };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
    >
      {shapes(name).map((s, i) => createElement(s.tag, { key: i, ...s.attrs }))}
    </svg>
  );
}
