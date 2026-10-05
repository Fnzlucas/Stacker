import { useSyncExternalStore } from 'react';

const noSubscribe = (): (() => void) => () => undefined;

/**
 * Valeur lue dans le navigateur après l'hydratation, `serverValue` pendant le
 * pré-rendu et la première hydratation (pas de décalage de rendu).
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscribe, read, () => serverValue);
}
