import { describe, expect, it } from 'vitest';
import { academyStats } from './Academy';

describe('Academy', () => {
  it('statistiques : appels, meilleure note, appels réussis', () => {
    expect(academyStats([])).toEqual({ calls: 0, best: null, passedCount: 0 });
    expect(
      academyStats([
        { score: 45, passed: false },
        { score: null, passed: false },
        { score: 80, passed: true },
      ]),
    ).toEqual({ calls: 3, best: 80, passedCount: 1 });
  });
});
