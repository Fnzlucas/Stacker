/**
 * Stockage de la session Supabase (jetons d'accès et de rafraîchissement).
 *
 * C'est la SEULE donnée gardée dans le stockage du navigateur par l'app, et
 * ce n'est pas une donnée métier : aucun profil, aucun montant. Elle va :
 *   - dans localStorage si « Rester connecté sur cet appareil » est coché ;
 *   - sinon dans sessionStorage (effacée à la fermeture de l'onglet).
 * Le jeton d'accès expire en 1 h et le jeton de rafraîchissement tourne à
 * chaque usage (enable_refresh_token_rotation) ; la CSP stricte (aucun script
 * inline ni tiers hors Turnstile) limite le risque de vol par XSS.
 */
export interface SyncStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** Stockage en mémoire (une instance distincte par usage). */
function memoryStore(): SyncStorage {
  const memory = new Map<string, string>();
  return {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, v),
    removeItem: (k) => void memory.delete(k),
  };
}

/** Stockage du navigateur, ou mémoire si indisponible (navigation privée stricte, tests). */
function browserStore(kind: 'localStorage' | 'sessionStorage'): SyncStorage {
  try {
    const store = globalThis[kind];
    const probe = '__stacker_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return memoryStore();
  }
}

export interface SessionStorageAdapter extends SyncStorage {
  /** Choisit où la PROCHAINE session sera écrite. */
  setPersistent: (persistent: boolean) => void;
  isPersistent: () => boolean;
}

export function createSessionStorage(
  persistentStore: SyncStorage = browserStore('localStorage'),
  tabStore: SyncStorage = browserStore('sessionStorage'),
): SessionStorageAdapter {
  let persistent = true;
  return {
    setPersistent: (value) => {
      persistent = value;
    },
    isPersistent: () => persistent,
    // Une session déjà enregistrée garde son mode (ex. « Rester connecté »
    // décoché, puis rechargement de la page) : les rafraîchissements de
    // jeton sont réécrits au même endroit.
    getItem: (key) => {
      const inTab = tabStore.getItem(key);
      if (inTab !== null) {
        persistent = false;
        return inTab;
      }
      const stored = persistentStore.getItem(key);
      if (stored !== null) persistent = true;
      return stored;
    },
    setItem: (key, value) => {
      const [target, other] = persistent ? [persistentStore, tabStore] : [tabStore, persistentStore];
      target.setItem(key, value);
      other.removeItem(key);
    },
    removeItem: (key) => {
      persistentStore.removeItem(key);
      tabStore.removeItem(key);
    },
  };
}
