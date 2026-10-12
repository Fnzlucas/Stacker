import { describe, expect, it } from 'vitest';
import { FORMATION, FORMATION_IDS, fetchFormation, formationProgress, setModuleDone } from './formation';
import type { Backend } from './supabase';

describe('contenu de la formation', () => {
  it('identifiants uniques et acceptés par le serveur', () => {
    expect(new Set(FORMATION_IDS).size).toBe(FORMATION.length);
    for (const id of FORMATION_IDS) expect(id).toMatch(/^[a-z0-9-]{2,40}$/);
    expect(FORMATION_IDS).toContain('appel');
  });
  it('chaque module a du contenu ; scripts et objections présents', () => {
    for (const m of FORMATION) {
      expect(m.sections.length, m.id).toBeGreaterThan(0);
      for (const s of m.sections) expect(Boolean(s.text?.length ?? s.bullets?.length ?? s.script?.length ?? s.answers?.length), `${m.id} · ${s.title}`).toBe(true);
    }
    expect(FORMATION.find((m) => m.id === 'appel')?.sections.some((s) => s.script?.length)).toBe(true);
    expect(FORMATION.find((m) => m.id === 'objections')?.sections[0]?.answers?.length).toBeGreaterThanOrEqual(5);
  });
  it('aucune promesse de revenu, transparence sur le statut', () => {
    const all = JSON.stringify(FORMATION);
    expect(all).not.toMatch(/revenu garanti|gagner \d|€ par mois garanti|devenir riche/i);
    expect(all).toContain('Aucun revenu n’est garanti');
    expect(all).toContain('apporteur d’affaires indépendant');
    expect(all).toContain('14 jours');
  });
});

describe('progression', () => {
  it('compte, pourcentage, module suivant', () => {
    expect(formationProgress([])).toMatchObject({ done: 0, total: FORMATION.length, percent: 0, next: { id: 'bases' } });
    expect(formationProgress(['bases', 'inconnu'])).toMatchObject({ done: 1, next: { id: 'regles' } });
    expect(formationProgress(FORMATION_IDS)).toMatchObject({ done: FORMATION.length, percent: 100, next: null });
  });
  it('appels serveur et erreurs', async () => {
    const calls: unknown[] = [];
    const b = (data: unknown, error: { code?: string; message: string } | null = null, status = 200) =>
      ({
        db: {
          rpc: async (fn: string, args: unknown) => {
            calls.push([fn, args]);
            return { data, error, status };
          },
        },
      }) as unknown as Backend;
    await expect(fetchFormation(b(['bases']))).resolves.toEqual(['bases']);
    await expect(setModuleDone(b(['bases', 'appel']), 'appel', true)).resolves.toEqual(['bases', 'appel']);
    expect(calls).toEqual([
      ['my_formation', {}],
      ['formation_set_done', { p_module: 'appel', p_done: true }],
    ]);
    await expect(fetchFormation(b({ x: 1 }))).rejects.toMatchObject({ kind: 'server' });
    await expect(fetchFormation(b(null, { message: 'Failed to fetch' }, 0))).rejects.toMatchObject({ kind: 'network' });
    await expect(fetchFormation(b(null, { code: 'PGRST301', message: 'JWT expired' }, 401))).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(fetchFormation(b(null, { code: '22023', message: 'invalid_request' }, 400))).rejects.toMatchObject({ kind: 'server' });
  });
});
