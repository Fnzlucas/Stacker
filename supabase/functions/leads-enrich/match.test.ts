import { describe, expect, it } from 'vitest';
import { matchCompany, similarity, tokens } from './match.ts';

const result = (siren: string, name: string, cp = '30400') => ({
  siren,
  nom_complet: name,
  activite_principale: '43.22A',
  statut_diffusion: 'O',
  siege: { siret: `${siren}00011`, code_postal: cp, libelle_commune: 'VILLENEUVE', est_siege: true },
});
const api = (results: unknown[], status = 200) => async (url: string) => {
  calls.push(url);
  return new Response(JSON.stringify({ results, total_results: results.length }), { status });
};
let calls: string[] = [];

describe('ressemblance des noms', () => {
  it('mots significatifs, formes juridiques ignorées', () => {
    expect([...tokens('SARL Plomberie Durand & Fils')]).toEqual(['plomberie', 'durand', 'fils']);
    expect(similarity('Plomberie Durand', 'DURAND PAUL (PLOMBERIE DURAND)')).toBe(1);
    expect(similarity('Garage du Pont', 'GARAGE MARTIN')).toBe(0.5);
    expect(similarity('', 'x')).toBe(0);
  });
});

describe('rattachement SIRENE', () => {
  it('par SIREN lu sur le site', async () => {
    calls = [];
    const r = await matchCompany(api([result('812345678', 'PLOMBERIE DURAND')]), 'http://api.test', { name: 'Plomberie Durand', postcode: '30400' }, '812345678');
    expect(r?.siret).toBe('81234567800011');
    expect(new URL(calls[0]!).searchParams.get('q')).toBe('812345678');
  });
  it('par nom et code postal, seuil strict, ambiguïté refusée', async () => {
    calls = [];
    const ok = await matchCompany(api([result('111111111', 'ELECTRICITE MARTIN'), result('812345678', 'DURAND PAUL (PLOMBERIE DURAND)')]), 'http://api.test', { name: 'Plomberie Durand', postcode: '30400' }, null);
    expect(ok?.siret).toBe('81234567800011');
    const u = new URL(calls[0]!);
    expect(u.searchParams.get('code_postal')).toBe('30400');
    expect(u.searchParams.get('etat_administratif')).toBe('A');
    expect(await matchCompany(api([result('111111111', 'GARAGE MARTIN')]), 'http://api.test', { name: 'Garage du Pont', postcode: '30400' }, null)).toBeNull();
    expect(await matchCompany(api([result('111111111', 'PLOMBERIE DURAND'), result('222222222', 'PLOMBERIE DURAND')]), 'http://api.test', { name: 'Plomberie Durand', postcode: '30400' }, null)).toBeNull();
    expect(await matchCompany(api([result('812345678', 'PLOMBERIE DURAND', '84000')]), 'http://api.test', { name: 'Plomberie Durand', postcode: '30400' }, null)).toBeNull();
  });
  it('sans code postal, API en erreur ou réponse illisible : aucun rattachement', async () => {
    expect(await matchCompany(api([]), 'http://api.test', { name: 'X', postcode: null }, null)).toBeNull();
    expect(await matchCompany(api([], 500), 'http://api.test', { name: 'X', postcode: '30400' }, null)).toBeNull();
    expect(await matchCompany(async () => new Response('{}'), 'http://api.test', { name: 'X', postcode: '30400' }, null)).toBeNull();
  });
});
