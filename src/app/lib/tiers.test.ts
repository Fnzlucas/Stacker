import { describe, expect, it } from 'vitest';
import { formatRate, tierProgress, tiersSchema, type Tier } from './tiers';

const TIERS: Tier[] = tiersSchema.parse([
  { code: 'elite', label: 'Elite', rate_bps: 2500, min_active_clients: 25, max_active_clients: null, sort_order: 4, criteria_provisional: true },
  { code: 'rookie', label: 'Rookie', rate_bps: 1500, min_active_clients: 0, max_active_clients: 2, sort_order: 1, criteria_provisional: true },
  { code: 'legend', label: 'Legend', rate_bps: 2200, min_active_clients: 10, max_active_clients: 24, sort_order: 3, criteria_provisional: true },
  { code: 'pro', label: 'Pro', rate_bps: 1800, min_active_clients: 3, max_active_clients: 9, sort_order: 2, criteria_provisional: true },
]);

describe('paliers', () => {
  it('formate un taux en points de base', () => {
    expect(formatRate(1500)).toBe('15 %');
    expect(formatRate(1250)).toBe('12,5 %');
  });

  it('nouveau stacker : Rookie, 3 clients actifs avant Pro', () => {
    const p = tierProgress(TIERS, 'rookie', 0)!;
    expect(p.current.code).toBe('rookie');
    expect(p.next?.code).toBe('pro');
    expect(p).toMatchObject({ remaining: 3, percent: 0, done: 0, target: 3, provisional: true });
  });

  it('progression partielle entre deux seuils', () => {
    expect(tierProgress(TIERS, 'pro', 6)).toMatchObject({ remaining: 4, done: 3, target: 7, percent: 43 });
    expect(tierProgress(TIERS, 'rookie', 2)).toMatchObject({ remaining: 1, percent: 67 });
  });

  it('niveau maximal : aucun palier suivant', () => {
    expect(tierProgress(TIERS, 'elite', 31)).toMatchObject({ next: null, remaining: 0, percent: 100, done: 31, target: 31 });
  });

  it('valeurs hors bornes : bornées, jamais négatives', () => {
    expect(tierProgress(TIERS, 'pro', 50)).toMatchObject({ remaining: 0, percent: 100 });
    expect(tierProgress(TIERS, 'pro', -4)).toMatchObject({ remaining: 10, percent: 0, done: 0 });
  });

  it('seuils identiques : pas de division par zéro', () => {
    const flat = TIERS.map((t) => (t.code === 'pro' ? { ...t, min_active_clients: 0 } : t));
    expect(tierProgress(flat, 'rookie', 0)).toMatchObject({ percent: 0, target: 1 });
  });

  it('critères validés : provisional à false', () => {
    const final = TIERS.map((t) => ({ ...t, criteria_provisional: false }));
    expect(tierProgress(final, 'rookie', 0)?.provisional).toBe(false);
  });

  it('niveau inconnu : null', () => {
    expect(tierProgress(TIERS, 'legende', 0)).toBeNull();
  });
});
