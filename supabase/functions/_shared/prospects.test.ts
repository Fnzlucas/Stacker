import { describe, expect, it } from 'vitest';
import {
  NAF_LABELS,
  PRESETS,
  buildSearchUrl,
  departmentFromPostcode,
  normalizeSearch,
  oppositionRequestSchema,
  prospectScore,
  searchRequestSchema,
  toCompanyRow,
} from './prospects.ts';

const base = (over: Record<string, unknown> = {}) => ({
  siren: '123456789',
  nom_complet: '  PLOMBERIE   DURAND ',
  activite_principale: '43.22A',
  date_creation: '2024-03-01',
  nature_juridique: '1000',
  tranche_effectif_salarie: '01',
  statut_diffusion: 'O',
  etat_administratif: 'A',
  siege: { siret: '12345678900011', adresse: '1 RUE DU PONT 84000 AVIGNON', code_postal: '84000', libelle_commune: 'AVIGNON', departement: '84', latitude: '43.9493', longitude: '4.8055', est_siege: true, etat_administratif: 'A' },
  matching_etablissements: [],
  dirigeants: [{ nom: 'DURAND', prenoms: 'Paul', qualite: 'Gérant', annee_de_naissance: '1980', date_de_naissance: '1980-05' }],
  complements: { est_entrepreneur_individuel: true },
  ...over,
});

describe('requête de recherche', () => {
  it('Zod : zones valides, refus des valeurs hors bornes', () => {
    expect(searchRequestSchema.safeParse({ zone: { type: 'departement', value: '2A' }, page: 1 }).success).toBe(true);
    expect(searchRequestSchema.safeParse({ zone: { type: 'departement', value: '20' }, page: 1 }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ zone: { type: 'code_postal', value: '3040' }, page: 1 }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ zone: { type: 'autour', lat: 43.9, lng: 4.8, radius_km: 10 }, page: 1 }).success).toBe(true);
    expect(searchRequestSchema.safeParse({ zone: { type: 'autour', lat: 43.9, lng: 4.8, radius_km: 25 }, page: 1 }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ zone: { type: 'autour', lat: 40.4, lng: -3.7, radius_km: 5 }, page: 1 }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ zone: { type: 'departement', value: '30' }, page: 41 }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ zone: { type: 'departement', value: '30' }, page: 1, preset: 'banque' }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ zone: { type: 'departement', value: '30' }, page: 1, extra: 1 }).success).toBe(false);
  });

  it('normalisation : ordre des tailles et arrondi des coordonnées sans effet sur la clé', () => {
    const a = normalizeSearch({ zone: { type: 'autour', lat: 43.94931, lng: 4.80551, radius_km: 5 }, sizes: ['tpe', 'solo', 'tpe'], page: 2 });
    const b = normalizeSearch({ zone: { type: 'autour', lat: 43.9494, lng: 4.8058, radius_km: 5 }, sizes: ['solo', 'tpe'], page: 2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('URL exacte de /search (établissements actifs, minimal, 25 par page)', () => {
    const url = new URL(buildSearchUrl({ zone: { type: 'departement', value: '30' }, preset: 'beaute', sizes: ['solo'], page: 3 }));
    expect(url.origin + url.pathname).toBe('https://recherche-entreprises.api.gouv.fr/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      departement: '30',
      activite_principale: '96.02A,96.02B,96.04Z',
      tranche_effectif_salarie: 'NN,00',
      etat_administratif: 'A',
      minimal: 'true',
      include: 'siege,dirigeants,complements,matching_etablissements',
      limite_matching_etablissements: '1',
      per_page: '25',
      page: '3',
    });
  });

  it('URL de /near_point et du code postal', () => {
    const near = new URL(buildSearchUrl({ zone: { type: 'autour', lat: 43.9, lng: 4.8, radius_km: 20 }, sizes: ['pme'], page: 1 }, 'http://api.test'));
    expect(near.pathname).toBe('/near_point');
    expect(near.searchParams.get('radius')).toBe('20');
    expect(near.searchParams.get('long')).toBe('4.8');
    expect(near.searchParams.has('tranche_effectif_salarie')).toBe(false);
    const cp = new URL(buildSearchUrl({ zone: { type: 'code_postal', value: '30400' }, page: 1 }));
    expect(cp.searchParams.get('code_postal')).toBe('30400');
    expect(cp.searchParams.has('activite_principale')).toBe(false);
  });

  it('chaque code NAF des secteurs a un libellé', () => {
    for (const p of Object.values(PRESETS)) for (const code of p.naf) expect(NAF_LABELS[code], code).toBeTruthy();
  });
});

describe('résultats de l’API → entreprises', () => {
  it('ligne complète, sans date de naissance des dirigeants', () => {
    const row = toCompanyRow(base());
    expect(row).toEqual({
      siret: '12345678900011',
      name: 'PLOMBERIE DURAND',
      naf: '43.22A',
      naf_label: 'Plomberie, eau et gaz',
      employee_band: '01',
      legal_category: '1000',
      is_sole_trader: true,
      created_on: '2024-03-01',
      is_head_office: true,
      address: '1 RUE DU PONT 84000 AVIGNON',
      postcode: '84000',
      city: 'AVIGNON',
      department: '84',
      latitude: 43.9493,
      longitude: 4.8055,
      officers: [{ nom: 'DURAND', prenoms: 'Paul', qualite: 'Gérant' }],
    });
    expect(JSON.stringify(row)).not.toContain('1980');
  });

  it('établissement correspondant au filtre plutôt que le siège', () => {
    const row = toCompanyRow(base({ matching_etablissements: [{ siret: '12345678900029', code_postal: '30400', libelle_commune: 'VILLENEUVE-LES-AVIGNON', est_siege: false, etat_administratif: 'A' }] }));
    expect(row?.siret).toBe('12345678900029');
    expect(row?.department).toBe('30');
    expect(row?.is_head_office).toBe(false);
  });

  it('exclusions : non diffusible, fermée, SIRET d’une autre entreprise, réponse illisible', () => {
    expect(toCompanyRow(base({ statut_diffusion: 'P' }))).toBeNull();
    expect(toCompanyRow(base({ etat_administratif: 'C' }))).toBeNull();
    expect(toCompanyRow(base({ siege: { siret: '99999999900011', etat_administratif: 'A' } }))).toBeNull();
    expect(toCompanyRow(base({ siege: { siret: '12345678900011', etat_administratif: 'F' } }))).toBeNull();
    expect(toCompanyRow(base({ siege: null }))).toBeNull();
    expect(toCompanyRow(base({ nom_complet: '   ', nom_raison_sociale: null }))).toBeNull();
    expect(toCompanyRow({ pas: 'une entreprise' })).toBeNull();
  });

  it('valeurs manquantes ou invalides : null, jamais inventées', () => {
    const row = toCompanyRow(base({ activite_principale: '4322A', date_creation: '2024', dirigeants: [{ denomination: 'HOLDING X', qualite: 'Président' }], siege: { siret: '12345678900011', code_postal: '20090', latitude: 'n/a' } }));
    expect(row).toMatchObject({ naf: null, naf_label: null, created_on: null, department: '2A', latitude: null, officers: [{ denomination: 'HOLDING X', qualite: 'Président' }] });
  });

  it('département depuis le code postal', () => {
    expect(departmentFromPostcode('30400')).toBe('30');
    expect(departmentFromPostcode('97200')).toBe('972');
    expect(departmentFromPostcode('20200')).toBe('2B');
    expect(departmentFromPostcode('2000')).toBeNull();
    expect(departmentFromPostcode(null)).toBeNull();
  });
});

describe('score', () => {
  const today = new Date('2026-10-20T00:00:00Z');
  it('déterministe et borné', () => {
    const c = { created_on: '2025-01-10', employee_band: '00', is_head_office: true };
    expect(prospectScore(c, today)).toBe(100);
    expect(prospectScore(c, today)).toBe(prospectScore({ ...c }, today));
    expect(prospectScore({ created_on: '2018-01-01', employee_band: '11', is_head_office: false }, today)).toBe(55);
    expect(prospectScore({ created_on: '1990-01-01', employee_band: '22', is_head_office: null }, today)).toBe(30);
    expect(prospectScore({ created_on: null, employee_band: null, is_head_office: null }, today)).toBe(50);
  });
});

describe('opposition', () => {
  it('jeton du lien ou formulaire (SIREN et/ou email)', () => {
    expect(oppositionRequestSchema.safeParse({ token: 'a'.repeat(48) }).success).toBe(true);
    expect(oppositionRequestSchema.safeParse({ token: 'z'.repeat(48) }).success).toBe(false);
    expect(oppositionRequestSchema.safeParse({ siren: '123 456 789', turnstileToken: 't' })).toMatchObject({ success: true, data: { siren: '123456789' } });
    expect(oppositionRequestSchema.safeParse({ email: ' Contact@X.fr ', turnstileToken: 't' })).toMatchObject({ success: true, data: { email: 'contact@x.fr' } });
    expect(oppositionRequestSchema.safeParse({ turnstileToken: 't' }).success).toBe(false);
    expect(oppositionRequestSchema.safeParse({ siren: '1234', turnstileToken: 't' }).success).toBe(false);
  });
});
