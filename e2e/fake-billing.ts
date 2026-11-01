/**
 * Abonnement stacker dans le faux Supabase des tests e2e : mêmes règles que
 * la base (supabase/migrations/20261013090000_billing.sql) pour ce que l'app
 * affiche — offre de lancement, paiement Mollie (simulé), accès conditionné,
 * résiliation à la fin de la période payée.
 */
import type { StackerInfo } from './fake-prospects';

type Reply = [number, unknown];
const pg = (status: number, code: string, message: string): Reply => [status, { code, message, details: null, hint: null }];

export type Plan = 'academy' | 'pro' | 'duo';
export const PRICES: Record<Plan, number> = { academy: 1299, pro: 999, duo: 1499 };

interface Sub {
  status: 'aucun' | 'en_attente' | 'actif' | 'impaye' | 'resilie';
  plan: Plan;
  pending_plan: Plan | null;
  launch_member: boolean;
  launch_until: string | null;
  current_period_end: string | null;
  method_label: string | null;
  cancel_at_period_end: boolean;
  charges: { period_start: string; amount_cents: number; method: 'mollie' | 'commissions'; status: 'en_attente' | 'paye' | 'echoue'; created_at: string; payment: string }[];
}

const today = () => new Date().toISOString().slice(0, 10);
const plusMonths = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x.toISOString().slice(0, 10);
};

/** Actions réservées aux abonnés quand l'abonnement est exigé. */
export const GATED_RPC = new Set(['prospect_claim', 'campaign_start']);
export const CHECKOUT_URL = 'https://www.mollie.com/checkout/select-method/e2e-test';

export class FakeBilling {
  required = false;
  launchSeats = 100;
  private subs = new Map<string, Sub>();
  private seq = 0;

  private sub(id: string): Sub {
    let s = this.subs.get(id);
    if (!s) {
      s = { status: 'aucun', plan: 'duo', pending_plan: null, launch_member: false, launch_until: null, current_period_end: null, method_label: null, cancel_at_period_end: false, charges: [] };
      this.subs.set(id, s);
    }
    return s;
  }

  private current(id: string): Sub | null {
    const s = this.subs.get(id);
    if (!s || !['actif', 'impaye'].includes(s.status) || !s.current_period_end) return null;
    return (s.cancel_at_period_end ? s.current_period_end > today() : s.current_period_end >= today()) ? s : null;
  }

  /** Accès Pro : prospection, campagnes, signature. */
  hasAccess(id: string): boolean {
    if (!this.required) return true;
    const s = this.current(id);
    return s !== null && s.plan !== 'academy';
  }

  /** Accès Academy : entraînement face à l'IA. */
  hasAcademy(id: string): boolean {
    if (!this.required) return true;
    const s = this.current(id);
    return s !== null && s.plan !== 'pro';
  }

  private view(id: string): unknown {
    const s = this.sub(id);
    const taken = [...this.subs.values()].filter((x) => x.launch_member).length;
    return {
      required: this.required,
      has_access: this.hasAccess(id),
      has_academy: this.hasAcademy(id),
      status: s.status,
      plan: s.plan,
      pending_plan: s.pending_plan,
      prices: PRICES,
      price_cents: PRICES[s.plan],
      launch_member: s.launch_member,
      launch_until: s.launch_until,
      launch_seats_left: Math.max(this.launchSeats - taken, 0),
      launch_priority: false,
      current_period_end: s.current_period_end,
      method_label: s.method_label,
      cancel_at_period_end: s.cancel_at_period_end,
      charges: [...s.charges].reverse().map(({ payment: _p, ...c }) => c),
    };
  }

  rpc(fn: string, b: Record<string, unknown>, st: StackerInfo | null): Reply | null {
    if (fn === 'my_billing') {
      if (!st) return pg(401, '42501', 'unauthorized');
      return [200, this.view(st.id)];
    }
    if (fn === 'billing_set_auto_renew') {
      if (!st) return pg(401, '42501', 'unauthorized');
      const s = this.sub(st.id);
      if (!['actif', 'impaye'].includes(s.status)) return pg(404, 'P0002', 'no_subscription');
      s.cancel_at_period_end = b['p_on'] === false;
      return [200, this.view(st.id)];
    }
    if (fn === 'billing_set_plan') {
      if (!st) return pg(401, '42501', 'unauthorized');
      const plan = b['p_plan'] as Plan;
      if (!(plan in PRICES)) return pg(400, '22023', 'invalid_plan');
      const s = this.sub(st.id);
      if (['actif', 'impaye'].includes(s.status)) s.pending_plan = plan === s.plan ? null : plan;
      else s.plan = plan;
      return [200, this.view(st.id)];
    }
    if (st && GATED_RPC.has(fn) && !this.hasAccess(st.id)) return pg(400, 'P0001', 'subscription_required');
    return null;
  }

  /** Edge Function billing-checkout : page de paiement Mollie (simulée). */
  checkout(st: StackerInfo | null, body: Record<string, unknown> = {}): Reply {
    if (body['accept_terms'] !== true || body['immediate_start'] !== true || typeof body['terms_version'] !== 'string') return [400, { ok: false, error: 'consent_required' }];
    const plan = body['plan'] as Plan;
    if (!(plan in PRICES)) return [400, { ok: false, error: 'invalid_plan' }];
    if (!st) return [401, { ok: false, error: 'unauthorized' }];
    if (!st.onboarded) return [403, { ok: false, error: 'onboarding_required' }];
    const s = this.sub(st.id);
    if (s.status === 'actif' && (s.current_period_end ?? '') >= today()) return [409, { ok: false, error: 'already_active' }];
    if (s.status === 'aucun' || s.status === 'resilie') s.status = 'en_attente';
    s.plan = plan;
    s.pending_plan = null;
    for (const c of s.charges) if (c.status === 'en_attente') c.status = 'echoue';
    s.charges.push({ period_start: today(), amount_cents: PRICES[plan], method: 'mollie', status: 'en_attente', created_at: new Date().toISOString(), payment: `tr_e2e${String(++this.seq)}` });
    return [200, { ok: true, url: CHECKOUT_URL }];
  }

  /** Simule le webhook Mollie : le dernier paiement en attente est payé. */
  confirmPayment(stackerId: string, label = 'Carte •••• 4242'): void {
    const s = this.sub(stackerId);
    const c = [...s.charges].reverse().find((x) => x.status === 'en_attente');
    if (!c) return;
    c.status = 'paye';
    const taken = [...this.subs.values()].filter((x) => x.launch_member).length;
    if (!s.launch_member && taken < this.launchSeats) {
      s.launch_member = true;
      s.launch_until = plusMonths(today(), 12);
    }
    s.status = 'actif';
    s.method_label = label;
    s.current_period_end = plusMonths(s.current_period_end && s.current_period_end > c.period_start ? s.current_period_end : c.period_start, 1);
  }
}
