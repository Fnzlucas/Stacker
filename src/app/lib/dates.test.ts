import { describe, expect, it } from 'vitest';
import { formatLongDate, initials, todayLabel } from './dates';

describe('dates et initiales', () => {
  it('le 5 octobre 2026 est un LUNDI (heure de Paris)', () => {
    expect(todayLabel(new Date('2026-10-05T08:00:00Z'))).toBe('LUNDI 5 OCTOBRE');
    // 23 h 30 UTC le 5 = 1 h 30 le 6 à Paris.
    expect(todayLabel(new Date('2026-10-05T23:30:00Z'))).toBe('MARDI 6 OCTOBRE');
  });
  it('date longue', () => {
    expect(formatLongDate('2026-10-20T07:00:00Z')).toBe('20 octobre 2026');
    expect(formatLongDate(null)).toBeNull();
    expect(formatLongDate('pas une date')).toBeNull();
  });
  it('initiales', () => {
    expect(initials('Inès', 'Martin')).toBe('IM');
    expect(initials(' élodie ')).toBe('É');
    expect(initials(null, null)).toBe('?');
  });
});
