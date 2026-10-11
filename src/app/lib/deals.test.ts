import { describe, expect, it } from 'vitest';
import { ApiError } from './apiError';
import {
  DealError,
  commissionCents,
  dealErrorMessage,
  emptyDealInput,
  engagementLabel,
  fetchCatalog,
  fetchDeal,
  fetchEarnings,
  fetchMyDeals,
  formatEuros,
  formatIban,
  groupByBrand,
  isValidIban,
  normalizeIban,
  periodLabel,
  previewDeal,
  requestPayout,
  setPayoutAccount,
  signDeal,
  stepErrors,
  toPayload,
  type DealInput,
  type Offer,
} from './deals';
import type { Backend } from './supabase';

const OFFER: Offer = {
  id: 'alma-pro',
  brand: 'Alma Company',
  category: 'Création de Sites Web',
  description: '',
  name: 'Pro',
  price_cents: 6999,
  unit_label: null,
  qty_min: 1,
  qty_max: 1,
  engagement_months: 12,
  features: ['Max 15 pages'],
  recommended: true,
};
const ROOMS: Offer = { ...OFFER, id: 'inroom-hotel-moyen', brand: 'InRoom', name: 'Hôtel moyen', price_cents: 500, unit_label: 'chambre', qty_min: 21, qty_max: 80, engagement_months: 0 };

const VALID: DealInput = {
  ...emptyDealInput(),
  offer_id: 'alma-pro',
  siret: '732 829 320 00074',
  company_name: 'Boulangerie Test',
  company_address: '1 rue de la Paix, 30000 Nîmes',
  first_name: 'Jean',
  last_name: 'Dupont',
  email: ' Contact@Test.fr ',
  phone: '06 12 34 56 78',
  iban_holder: 'Boulangerie Test',
  iban: 'fr76 3000 6000 0112 3456 7890 189',
  accept_mandate: true,
};

describe('IBAN', () => {
  it('clé modulo 97, longueur par pays, normalisation', () => {
    expect(isValidIban('FR76 3000 6000 0112 3456 7890 189')).toBe(true);
    expect(isValidIban('fr7630006000011234567890189')).toBe(true);
    expect(isValidIban('FR76 3000 6000 0112 3456 7890 188')).toBe(false);
    expect(isValidIban('FR763000600001123456789018')).toBe(false);
    expect(isValidIban('XX7630006000011234567890189')).toBe(false);
    expect(isValidIban('pas un iban')).toBe(false);
    expect(isValidIban('BE68539007547034')).toBe(true);
    expect(normalizeIban(' fr76-3000.6000 ')).toBe('FR7630006000');
    expect(formatIban('fr7630006000011234567890189')).toBe('FR76 3000 6000 0112 3456 7890 189');
  });
});

describe('validation des étapes', () => {
  it('offre : choix obligatoire, quantité dans le palier', () => {
    expect(stepErrors('offre', { ...VALID, offer_id: '' }, undefined)).toEqual({ offer_id: 'Choisis une offre.' });
    expect(stepErrors('offre', VALID, OFFER)).toEqual({});
    expect(stepErrors('offre', { ...VALID, quantity: 10 }, ROOMS)['quantity']).toBe('Entre 21 et 80 chambres.');
    expect(stepErrors('offre', { ...VALID, quantity: 30 }, ROOMS)).toEqual({});
    expect(stepErrors('offre', { ...VALID, quantity: 2 }, OFFER)['quantity']).toBe('Quantité fixe : 1.');
  });

  it('client : SIRET, coordonnées et signataire', () => {
    expect(stepErrors('client', VALID, OFFER)).toEqual({});
    const e = stepErrors('client', { ...VALID, siret: '123', company_name: 'x', company_address: 'ici', first_name: ' ', last_name: '', role: 'x', email: 'faux', phone: '12' }, OFFER);
    expect(Object.keys(e).sort()).toEqual(['company_address', 'company_name', 'email', 'first_name', 'last_name', 'phone', 'role', 'siret']);
  });

  it('paiement : titulaire, IBAN valide, mandat accepté', () => {
    expect(stepErrors('paiement', VALID, OFFER)).toEqual({});
    expect(Object.keys(stepErrors('paiement', { ...VALID, iban_holder: '', iban: 'FR00', accept_mandate: false }, OFFER)).sort()).toEqual(['accept_mandate', 'iban', 'iban_holder']);
  });

  it('corps envoyé : SIRET sans espace, email en minuscules, téléphone E.164, IBAN normalisé', () => {
    expect(toPayload(VALID)).toMatchObject({ siret: '73282932000074', email: 'contact@test.fr', phone: '+33612345678', iban: 'FR7630006000011234567890189' });
    expect(toPayload({ ...VALID, phone: 'abc' })['phone']).toBe('abc');
  });
});

describe('montants et libellés', () => {
  it('euros à la française', () => {
    expect(formatEuros(6999)).toBe('69,99 €');
    expect(formatEuros(150000)).toBe('1 500 €');
    expect(formatEuros(1500, { always: true })).toBe('15,00 €');
  });
  it('commission arrondie à l’inférieur, comme le serveur', () => {
    expect(commissionCents(6999, 1500)).toBe(1049);
    expect(commissionCents(10000, 1800)).toBe(1800);
  });
  it('engagement, regroupement par marque, période', () => {
    expect(engagementLabel(0)).toBe('Sans engagement');
    expect(engagementLabel(12)).toBe('Engagement 12 mois');
    const groups = groupByBrand([OFFER, { ...OFFER, id: 'alma-premium', name: 'Premium' }, ROOMS]);
    expect(groups.map((g) => [g.brand, g.offers.length])).toEqual([
      ['Alma Company', 2],
      ['InRoom', 1],
    ]);
    expect(periodLabel('2026-11-01')).toBe('novembre 2026');
    expect(periodLabel('x')).toBe('x');
  });
  it('messages d’erreur', () => {
    expect(dealErrorMessage(new DealError('contract_changed'))).toMatch(/a changé/);
    expect(dealErrorMessage(new DealError('inconnu'))).toMatch(/momentanément indisponible/);
    expect(dealErrorMessage(new ApiError('network'))).toMatch(/Connexion impossible/);
    expect(dealErrorMessage(new ApiError('server'))).toMatch(/momentanément indisponible/);
    expect(dealErrorMessage(new Error('x'))).toMatch(/momentanément indisponible/);
  });
});

describe('appels serveur', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const calls: { fn: string; args: unknown }[] = [];
  const b = (data: unknown, error: { code?: string; message?: string } | null = null, status = 200) =>
    ({
      db: {
        rpc: async (fn: string, args: unknown) => {
          calls.push({ fn, args });
          return { data, error, status };
        },
      },
    }) as unknown as Backend;

  it('arguments nommés p_* et réponses validées', async () => {
    await expect(fetchCatalog(b({ rate_bps: 1500, offers: [OFFER] }))).resolves.toMatchObject({ rate_bps: 1500 });
    const preview = { reference: 'STK-1', mandate_ref: 'M', contract_text: 't', contract_sha256: 'a'.repeat(64), monthly_price_cents: 6999, rate_bps: 1500, commission_cents: 1049 };
    await expect(previewDeal(b(preview), VALID)).resolves.toMatchObject({ commission_cents: 1049 });
    await expect(signDeal(b({ id: ID, reference: 'STK-1', monthly_price_cents: 6999, rate_bps: 1500, commission_cents: 1049 }), VALID, 'data:png', 'a'.repeat(64))).resolves.toMatchObject({ id: ID });
    await expect(fetchMyDeals(b([]))).resolves.toEqual([]);
    await expect(fetchDeal(b({ id: 'x' }), ID)).rejects.toMatchObject({ kind: 'server' });
    await expect(requestPayout(b(ID))).resolves.toBe(ID);
    await expect(setPayoutAccount(b(null), ' Alice ', 'fr76 3000 6000 0112 3456 7890 189')).resolves.toBeNull();
    await expect(fetchEarnings(b({}))).rejects.toMatchObject({ kind: 'server' });
    expect(calls.map((c) => c.fn)).toEqual(['deal_catalog', 'deal_preview', 'deal_sign', 'my_deals', 'deal_detail', 'payout_request', 'payout_set_account', 'my_earnings']);
    expect(calls[2]?.args).toMatchObject({ p_signature: 'data:png', p_contract_sha256: 'a'.repeat(64), p_input: { phone: '+33612345678' } });
    expect(calls[4]?.args).toEqual({ p_deal: ID });
    expect(calls[6]?.args).toEqual({ p_holder: 'Alice', p_iban: 'FR7630006000011234567890189' });
  });

  it('erreurs SQL, réseau, session', async () => {
    await expect(fetchMyDeals(b(null, { code: 'P0001', message: 'onboarding_required' }, 400))).rejects.toMatchObject({ code: 'onboarding_required' });
    await expect(fetchMyDeals(b(null, { message: 'Failed to fetch' }, 0))).rejects.toMatchObject({ kind: 'network' });
    await expect(fetchMyDeals(b(null, { code: 'PGRST301', message: 'JWT expired' }, 401))).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(fetchMyDeals(b(null, { message: 'Erreur interne imprévue' }, 500))).rejects.toMatchObject({ kind: 'server' });
  });
});
