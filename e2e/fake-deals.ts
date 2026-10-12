/**
 * Deals et gains dans le faux Supabase des tests e2e : mêmes RÈGLES que la
 * base (supabase/migrations/20261012090000_deals.sql) pour ce que l'app
 * affiche et envoie — catalogue, validation, contrat rendu par le serveur
 * avec empreinte SHA-256, signature, rattachement au prospect, commissions
 * disponibles après délai, virement de tout le solde disponible.
 *
 * Offres et clients : données DE TEST, jamais affichées hors des tests.
 */
import { createHash } from 'node:crypto';
import type { FakeClaim } from './fake-prospects';
import type { StackerInfo } from './fake-prospects';

type Reply = [number, unknown];
const pg = (status: number, code: string, message: string): Reply => [status, { code, message, details: null, hint: null }];
const raise = (message: string, status = 400): Reply => pg(status, 'P0001', message);

export interface FakeOffer {
  id: string;
  brand: string;
  category: string;
  description: string;
  name: string;
  price_cents: number;
  unit_label: string | null;
  qty_min: number;
  qty_max: number;
  engagement_months: number;
  features: string[];
  recommended: boolean;
  active: boolean;
}

export const TEST_OFFERS: FakeOffer[] = [
  { id: 'alma-starter', brand: 'Alma Company', category: 'Création de Sites Web', description: '', name: 'Starter', price_cents: 3999, unit_label: null, qty_min: 1, qty_max: 1, engagement_months: 12, features: ['Site vitrine 5 pages', 'Hébergement inclus'], recommended: false, active: true },
  { id: 'alma-pro', brand: 'Alma Company', category: 'Création de Sites Web', description: '', name: 'Pro', price_cents: 6999, unit_label: null, qty_min: 1, qty_max: 1, engagement_months: 12, features: ['Max 15 pages', 'Blog intégré'], recommended: true, active: true },
  { id: 'inroom-hotel-moyen', brand: 'InRoom', category: 'Conciergerie Hôtelière', description: '', name: 'Hôtel moyen', price_cents: 500, unit_label: 'chambre', qty_min: 21, qty_max: 80, engagement_months: 12, features: ['21 à 80 chambres'], recommended: true, active: true },
  { id: 'rh-pme-pro', brand: 'RH PME', category: 'Ressources Humaines', description: '', name: 'Pro', price_cents: 29900, unit_label: null, qty_min: 1, qty_max: 1, engagement_months: 12, features: [], recommended: false, active: false },
];

export interface FakeDeal {
  id: string;
  reference: string;
  stacker: string;
  claim_id: string | null;
  offer: FakeOffer;
  quantity: number;
  monthly_price_cents: number;
  input: Record<string, string>;
  iban_last4: string;
  mandate_ref: string;
  contract_text: string;
  contract_sha256: string;
  signature_png: string;
  signed_at: string;
  withdrawal_until: string;
  status: 'signe' | 'actif' | 'suspendu' | 'resilie' | 'annule';
  activated_at: string | null;
}

export interface FakeCommission {
  id: number;
  stacker: string;
  deal_id: string;
  period: string;
  client_amount_cents: number;
  rate_bps: number;
  amount_cents: number;
  status: 'disponible' | 'demandee' | 'versee';
  available_at: string;
  created_at: string;
  payout_id: string | null;
  paid_at: string;
}

export interface FakePayout {
  id: string;
  stacker: string;
  amount_cents: number;
  status: 'demande' | 'verse' | 'refuse';
  iban_last4: string;
  requested_at: string;
  processed_at: string | null;
  reference?: string | null;
}

const DAY = 86_400_000;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function luhnSiret(siret: string): boolean {
  if (!/^\d{14}$/.test(siret)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let v = Number(siret[13 - i]);
    if (i % 2 === 1) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
  }
  return sum % 10 === 0;
}

const LENGTHS: Record<string, number> = { FR: 27, BE: 16, LU: 20, DE: 22, ES: 24, IT: 27, CH: 21, MC: 27 };
export function ibanOk(raw: string): boolean {
  const iban = raw.replace(/[\s.-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban) || LENGTHS[iban.slice(0, 2)] !== iban.length) return false;
  let rem = 0;
  for (const ch of iban.slice(4) + iban.slice(0, 4)) rem = /\d/.test(ch) ? (rem * 10 + Number(ch)) % 97 : (rem * 100 + ch.charCodeAt(0) - 55) % 97;
  return rem === 1;
}

const eur = (c: number) => `${String(Math.trunc(c / 100)).replace(/\B(?=(\d{3})+$)/g, ' ')},${String(Math.abs(c) % 100).padStart(2, '0')} €`;

export class FakeDeals {
  offers = TEST_OFFERS.map((o) => ({ ...o }));
  deals: FakeDeal[] = [];
  commissions: FakeCommission[] = [];
  payouts: FakePayout[] = [];
  accounts = new Map<string, { holder: string; iban_last4: string; iban: string }>();
  private seq = 0;

  constructor(
    private readonly newId: () => string,
    private readonly rate: (stackerId: string) => number,
    private readonly claims: () => FakeClaim[],
  ) {}

  /** Paiement d'un client (webhook Mollie / admin), pour préparer un test. `availableInDays` négatif = déjà disponible. */
  recordPayment(dealId: string, period: string, amountCents: number, availableInDays: number): void {
    const d = this.deals.find((x) => x.id === dealId);
    if (!d) throw new Error('deal inconnu');
    const rate = this.rate(d.stacker);
    this.commissions.push({
      id: ++this.seq,
      stacker: d.stacker,
      deal_id: d.id,
      period,
      client_amount_cents: amountCents,
      rate_bps: rate,
      amount_cents: Math.floor((amountCents * rate) / 10000),
      status: 'disponible',
      available_at: new Date(Date.now() + availableInDays * DAY).toISOString(),
      created_at: new Date().toISOString(),
      payout_id: null,
      paid_at: new Date().toISOString(),
    });
    if (d.status === 'signe') {
      d.status = 'actif';
      d.activated_at = new Date().toISOString();
    }
  }

  private validate(input: unknown, requireConsent: boolean): Reply | { offer: FakeOffer; qty: number; v: Record<string, string> } {
    if (!input || typeof input !== 'object') return pg(400, '22023', 'invalid_input');
    const i = input as Record<string, unknown>;
    const offer = this.offers.find((o) => o.id === i['offer_id'] && o.active);
    if (!offer) return pg(404, 'P0002', 'offer_unavailable');
    const qty = typeof i['quantity'] === 'number' ? i['quantity'] : 1;
    if (!Number.isInteger(qty) || qty < offer.qty_min || qty > offer.qty_max) return pg(400, '22023', 'invalid_quantity');
    const v = {
      siret: s(i['siret']).replace(/\s/g, ''),
      company_name: s(i['company_name']),
      company_address: s(i['company_address']),
      first_name: s(i['first_name']),
      last_name: s(i['last_name']),
      role: s(i['role']),
      email: s(i['email']).toLowerCase(),
      phone: s(i['phone']),
      iban_holder: s(i['iban_holder']),
      iban: s(i['iban']).replace(/[\s.-]/g, '').toUpperCase(),
      claim_id: s(i['claim_id']),
    };
    if (!luhnSiret(v.siret)) return pg(400, '22023', 'invalid_siret');
    if (v.company_name.length < 2) return pg(400, '22023', 'invalid_company');
    if (v.company_address.length < 5) return pg(400, '22023', 'invalid_address');
    if (!v.first_name || !v.last_name) return pg(400, '22023', 'invalid_contact');
    if (v.role.length < 2) return pg(400, '22023', 'invalid_role');
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(v.email)) return pg(400, '22023', 'invalid_email');
    if (!/^\+[1-9]\d{7,14}$/.test(v.phone)) return pg(400, '22023', 'invalid_phone');
    if (v.iban_holder.length < 2) return pg(400, '22023', 'invalid_holder');
    if (!ibanOk(v.iban)) return pg(400, '22023', 'invalid_iban');
    if (requireConsent && (i['accept_terms'] !== true || i['accept_mandate'] !== true)) return pg(400, '22023', 'consent_required');
    return { offer, qty, v };
  }

  private refs(st: StackerInfo, v: Record<string, string>, offer: FakeOffer): [string, string] {
    const day = new Date().toISOString().slice(0, 10);
    return [`STK-${sha(st.id + (v['siret'] ?? '') + offer.id + day).slice(0, 8).toUpperCase()}`, `STKM${sha(`rum${st.id}${v['siret'] ?? ''}${v['iban'] ?? ''}${day}`).slice(0, 16).toUpperCase()}`];
  }

  private contract(st: StackerInfo, ref: string, rum: string, offer: FakeOffer, qty: number, v: Record<string, string>): string {
    const iban = v['iban'] ?? '';
    return [
      'CONTRAT D’ABONNEMENT ET MANDAT DE PRÉLÈVEMENT SEPA',
      `Référence : ${ref}`,
      `Le client : ${v['company_name'] ?? ''}, SIRET ${v['siret'] ?? ''}, ${v['company_address'] ?? ''}, représenté par ${v['first_name'] ?? ''} ${v['last_name'] ?? ''} (${v['role'] ?? ''}).`,
      `Service : ${offer.brand} — ${offer.name}${offer.unit_label ? ` · ${String(qty)} ${offer.unit_label}s` : ''}.`,
      `Prix : ${eur(offer.price_cents * qty)} par mois. TVA non applicable, art. 293 B du CGI.`,
      'Droit de rétractation : 14 jours. Le premier prélèvement intervient à l’issue de ce délai.',
      `Apporteur d’affaires : ${[st.firstName, st.lastName].filter(Boolean).join(' ') || 'un stacker'}.`,
      `Mandat SEPA — RUM ${rum} — IBAN ${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}.`,
    ].join('\n\n');
  }

  rpc(fn: string, b: Record<string, unknown>, st: StackerInfo | null): Reply | null {
    const known = ['deal_catalog', 'deal_preview', 'deal_sign', 'my_deals', 'deal_detail', 'my_earnings', 'payout_set_account', 'payout_request'];
    if (!known.includes(fn)) return null;
    if (!st) return pg(401, '42501', 'permission denied');
    if (!st.onboarded) return pg(403, '42501', 'onboarding_required');
    const rate = this.rate(st.id);
    switch (fn) {
      case 'deal_catalog':
        return [200, { rate_bps: rate, offers: this.offers.filter((o) => o.active).map(({ active: _active, ...o }) => o) }];
      case 'deal_preview': {
        const r = this.validate(b['p_input'], false);
        if (Array.isArray(r)) return r;
        const [ref, rum] = this.refs(st, r.v, r.offer);
        const text = this.contract(st, ref, rum, r.offer, r.qty, r.v);
        const price = r.offer.price_cents * r.qty;
        return [200, { reference: ref, mandate_ref: rum, contract_text: text, contract_sha256: sha(text), monthly_price_cents: price, rate_bps: rate, commission_cents: Math.floor((price * rate) / 10000) }];
      }
      case 'deal_sign': {
        const r = this.validate(b['p_input'], true);
        if (Array.isArray(r)) return r;
        const sig = typeof b['p_signature'] === 'string' ? b['p_signature'] : '';
        if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(sig) || sig.length < 1500) return pg(400, '22023', 'invalid_signature');
        const [ref, rum] = this.refs(st, r.v, r.offer);
        if (this.deals.some((d) => d.reference === ref)) return pg(409, '23505', 'already_signed');
        const text = this.contract(st, ref, rum, r.offer, r.qty, r.v);
        if (b['p_contract_sha256'] !== sha(text)) return pg(409, '40001', 'contract_changed');
        let claim: FakeClaim | undefined;
        if (r.v['claim_id']) {
          claim = this.claims().find((c) => c.id === r.v['claim_id'] && c.stacker === st.id && c.released_at === null && c.status !== 'signe');
          if (!claim) return pg(404, 'P0002', 'not_found');
        }
        const price = r.offer.price_cents * r.qty;
        const deal: FakeDeal = {
          id: this.newId(),
          reference: ref,
          stacker: st.id,
          claim_id: claim?.id ?? null,
          offer: r.offer,
          quantity: r.qty,
          monthly_price_cents: price,
          input: r.v,
          iban_last4: (r.v['iban'] ?? '').slice(-4),
          mandate_ref: rum,
          contract_text: text,
          contract_sha256: sha(text),
          signature_png: sig,
          signed_at: new Date().toISOString(),
          withdrawal_until: new Date(Date.now() + 14 * DAY).toISOString(),
          status: 'signe',
          activated_at: null,
        };
        this.deals.push(deal);
        if (claim) {
          claim.status = 'signe';
          claim.expires_at = null;
          claim.next_action_at = null;
        }
        return [200, { id: deal.id, reference: ref, monthly_price_cents: price, rate_bps: rate, commission_cents: Math.floor((price * rate) / 10000) }];
      }
      case 'my_deals':
        return [
          200,
          this.deals
            .filter((d) => d.stacker === st.id)
            .sort((x, y) => y.signed_at.localeCompare(x.signed_at))
            .map((d) => ({
              id: d.id,
              reference: d.reference,
              status: d.status,
              company_name: d.input['company_name'],
              offer_label: `${d.offer.brand} · ${d.offer.name}`,
              monthly_price_cents: d.monthly_price_cents,
              signed_at: d.signed_at,
              activated_at: d.activated_at,
              withdrawal_until: d.withdrawal_until,
              earned_cents: this.commissions.filter((c) => c.deal_id === d.id).reduce((a, c) => a + c.amount_cents, 0),
            })),
        ];
      case 'deal_detail': {
        const d = this.deals.find((x) => x.id === b['p_deal'] && x.stacker === st.id);
        if (!d) return pg(404, 'P0002', 'not_found');
        return [
          200,
          {
            id: d.id,
            reference: d.reference,
            status: d.status,
            claim_id: d.claim_id,
            offer: { ...d.offer },
            quantity: d.quantity,
            monthly_price_cents: d.monthly_price_cents,
            company_name: d.input['company_name'],
            company_siret: d.input['siret'],
            company_address: d.input['company_address'],
            contact_name: `${d.input['first_name'] ?? ''} ${d.input['last_name'] ?? ''}`,
            contact_role: d.input['role'],
            contact_email: d.input['email'],
            contact_phone: d.input['phone'],
            iban_masked: `${(d.input['iban'] ?? '').slice(0, 2)}•• •••• ${d.iban_last4}`,
            mandate_ref: d.mandate_ref,
            contract_text: d.contract_text,
            contract_sha256: d.contract_sha256,
            signature_png: d.signature_png,
            signed_at: d.signed_at,
            withdrawal_until: d.withdrawal_until,
            activated_at: d.activated_at,
            ended_at: null,
            payments: this.commissions
              .filter((c) => c.deal_id === d.id)
              .map((c) => ({ period: c.period, amount_cents: c.client_amount_cents, paid_at: c.paid_at, commission_cents: c.amount_cents, rate_bps: c.rate_bps })),
          },
        ];
      }
      case 'my_earnings': {
        const mine = this.commissions.filter((c) => c.stacker === st.id);
        const now = Date.now();
        const sum = (f: (c: FakeCommission) => boolean) => mine.filter(f).reduce((a, c) => a + c.amount_cents, 0);
        const deals = this.deals.filter((d) => d.stacker === st.id);
        const future = mine.filter((c) => c.status === 'disponible' && Date.parse(c.available_at) > now).map((c) => c.available_at).sort();
        return [
          200,
          {
            rate_bps: rate,
            available_cents: sum((c) => c.status === 'disponible' && Date.parse(c.available_at) <= now),
            validating_cents: sum((c) => c.status === 'disponible' && Date.parse(c.available_at) > now),
            next_available_at: future[0] ?? null,
            requested_cents: sum((c) => c.status === 'demandee'),
            paid_cents: sum((c) => c.status === 'versee'),
            monthly_cents: Math.floor((deals.filter((d) => d.status === 'actif').reduce((a, d) => a + d.monthly_price_cents, 0) * rate) / 10000),
            pending_monthly_cents: Math.floor((deals.filter((d) => d.status === 'signe').reduce((a, d) => a + d.monthly_price_cents, 0) * rate) / 10000),
            signed_count: deals.filter((d) => ['signe', 'actif', 'suspendu'].includes(d.status)).length,
            active_count: deals.filter((d) => d.status === 'actif').length,
            min_payout_cents: 1000,
            payout_account: ((a) => (a ? { holder: a.holder, iban_last4: a.iban_last4 } : null))(this.accounts.get(st.id)),
            entries: [...mine]
              .sort((x, y) => y.created_at.localeCompare(x.created_at))
              .map((c) => ({
                id: c.id,
                period: c.period,
                amount_cents: c.amount_cents,
                rate_bps: c.rate_bps,
                client_amount_cents: c.client_amount_cents,
                status: c.status,
                created_at: c.created_at,
                available_at: c.available_at,
                company_name: this.deals.find((d) => d.id === c.deal_id)?.input['company_name'] ?? '',
                deal_id: c.deal_id,
              })),
            payouts: this.payouts.filter((p) => p.stacker === st.id).map(({ stacker: _s, ...p }) => p),
          },
        ];
      }
      case 'payout_set_account': {
        const holder = s(b['p_holder']);
        const iban = s(b['p_iban']);
        if (holder.length < 2) return pg(400, '22023', 'invalid_holder');
        if (!ibanOk(iban)) return pg(400, '22023', 'invalid_iban');
        if (this.payouts.some((p) => p.stacker === st.id && p.status === 'demande')) return raise('payout_pending');
        this.accounts.set(st.id, { holder, iban_last4: iban.slice(-4), iban: iban.replace(/\s/g, '').toUpperCase() });
        return [204, null];
      }
      case 'payout_request': {
        const acc = this.accounts.get(st.id);
        if (!acc) return raise('payout_account_required');
        if (this.payouts.some((p) => p.stacker === st.id && p.status === 'demande')) return raise('payout_pending');
        const ready = this.commissions.filter((c) => c.stacker === st.id && c.status === 'disponible' && Date.parse(c.available_at) <= Date.now());
        const amount = ready.reduce((a, c) => a + c.amount_cents, 0);
        if (amount < 1000) return pg(400, '22023', 'payout_too_small');
        const id = this.newId();
        this.payouts.push({ id, stacker: st.id, amount_cents: amount, status: 'demande', iban_last4: acc.iban_last4, requested_at: new Date().toISOString(), processed_at: null });
        for (const c of ready) {
          c.status = 'demandee';
          c.payout_id = id;
        }
        return [200, id];
      }
    }
    return null;
  }
}
