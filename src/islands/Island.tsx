import { createElement, type ComponentProps, type ReactElement } from 'react';
import { ISLANDS, type IslandName } from './registry';

/**
 * Pré-rendu : un îlot est rendu dans sa propre racine React (comme lors de
 * l'hydratation côté navigateur), pour que useId et l'arbre soient
 * identiques des deux côtés. Pendant le rendu de la page, <Island> pose un
 * emplacement ; src/ssr/render.tsx y injecte ensuite le HTML de l'îlot.
 */
export interface IslandSlot {
  name: IslandName;
  props: object;
  as: 'div' | 'span';
  className: string | undefined;
}

let collector: IslandSlot[] | null = null;

export function beginIslandCollection(): void {
  collector = [];
}

export function endIslandCollection(): IslandSlot[] {
  const out = collector ?? [];
  collector = null;
  return out;
}

export function Island<N extends IslandName>({
  name,
  props,
  as = 'div',
  className,
}: {
  name: N;
  props: ComponentProps<(typeof ISLANDS)[N]>;
  as?: 'div' | 'span';
  className?: string;
}): ReactElement {
  if (!collector) throw new Error('<Island> ne peut être rendu que pendant le pré-rendu (renderPage).');
  const index = collector.push({ name, props: props as object, as, className }) - 1;
  return createElement(as, { 'data-island-slot': String(index) });
}
