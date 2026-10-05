import { ContactForm } from './ContactForm';
import { WaitlistCount } from './WaitlistCount';
import { WaitlistForm } from './WaitlistForm';

/**
 * Îlots interactifs : seuls ces composants sont hydratés dans le navigateur.
 * Le reste des pages publiques est du HTML statique pré-rendu, sans JS.
 */
export const ISLANDS = {
  'waitlist-count': WaitlistCount,
  'waitlist-form': WaitlistForm,
  'contact-form': ContactForm,
} as const;

export type IslandName = keyof typeof ISLANDS;

export const isIslandName = (value: string): value is IslandName => Object.hasOwn(ISLANDS, value);
