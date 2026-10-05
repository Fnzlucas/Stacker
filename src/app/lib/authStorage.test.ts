import { describe, expect, it } from 'vitest';
import { createSessionStorage, type SyncStorage } from './authStorage';

const store = (): SyncStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

describe('stockage de session', () => {
  it('« Rester connecté » : localStorage', () => {
    const local = store();
    const tab = store();
    const s = createSessionStorage(local, tab);
    s.setPersistent(true);
    s.setItem('k', 'v');
    expect(local.data.get('k')).toBe('v');
    expect(tab.data.has('k')).toBe(false);
    expect(s.getItem('k')).toBe('v');
  });
  it('sinon : sessionStorage, et la copie persistante est effacée', () => {
    const local = store();
    const tab = store();
    local.data.set('k', 'ancien');
    const s = createSessionStorage(local, tab);
    s.setPersistent(false);
    s.setItem('k', 'v');
    expect(tab.data.get('k')).toBe('v');
    expect(local.data.has('k')).toBe(false);
  });
  it('après rechargement, une session d’onglet reste dans l’onglet', () => {
    const local = store();
    const tab = store();
    tab.data.set('k', 'v');
    const s = createSessionStorage(local, tab);
    expect(s.isPersistent()).toBe(true);
    expect(s.getItem('k')).toBe('v');
    expect(s.isPersistent()).toBe(false);
    s.setItem('k', 'v2');
    expect(tab.data.get('k')).toBe('v2');
    expect(local.data.has('k')).toBe(false);
  });
  it('une session persistante relue repasse en mode persistant', () => {
    const local = store();
    local.data.set('k', 'v');
    const s = createSessionStorage(local, store());
    s.setPersistent(false);
    expect(s.getItem('k')).toBe('v');
    expect(s.isPersistent()).toBe(true);
    expect(s.getItem('absent')).toBeNull();
  });
  it('suppression : des deux côtés', () => {
    const local = store();
    const tab = store();
    local.data.set('k', '1');
    tab.data.set('k', '2');
    createSessionStorage(local, tab).removeItem('k');
    expect(local.data.size + tab.data.size).toBe(0);
  });
  it('sans stockage navigateur (Node) : repli en mémoire', () => {
    const s = createSessionStorage();
    s.setItem('k', 'v');
    expect(s.getItem('k')).toBe('v');
    s.removeItem('k');
    expect(s.getItem('k')).toBeNull();
  });
});
