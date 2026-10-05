/**
 * Hydratation des îlots interactifs des pages publiques. Le reste de la
 * page est du HTML statique pré-rendu, qui fonctionne sans JavaScript.
 */
import { createElement, type ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { ISLANDS, isIslandName } from '../islands/registry';

for (const el of document.querySelectorAll<HTMLElement>('[data-island]')) {
  const name = el.dataset['island'] ?? '';
  if (!isIslandName(name)) continue;
  let props: object = {};
  try {
    const parsed: unknown = JSON.parse(el.dataset['props'] ?? '{}');
    if (parsed && typeof parsed === 'object') props = parsed;
  } catch {
    continue;
  }
  const component = ISLANDS[name] as (p: object) => ReactElement | null;
  hydrateRoot(el, createElement(component, props));
}
