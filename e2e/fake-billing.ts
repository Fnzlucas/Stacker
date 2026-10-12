/**
 * Abonnement stacker dans le faux Supabase des tests e2e : mêmes règles que
 * la base (supabase/migrations/20261013090000_billing.sql) pour ce que l'app
 * affiche — offre de lancement, paiement Mollie (simulé), accès conditionné,
 * résiliation à la fin de la période payée.
 */
import type { StackerInfo } from './fake-prospects';

type Reply = [number, unknown];
const pg = (status: number, code: string, message: string): Reply => [status, { code, message, details: null, hint: null }];

interface Sub {
  status: 'aucun' | 'en_attente' | 'actif' | 'impaye' | 'resilie';
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
export const GATED_RPC = new Set(['prospect_claim', 'campaign_start', 'deal_preview', 'deal_sign']);
export const CHECKOUT_URL = 'https://www.mollie.com/checkout/select-method/e2e-test';

export class FakeBilling {
  required = false;
  priceCents = 699;
  launchSeats = 100;
  private subs = new Map<string, Sub>();
  private seq = 0;

  private sub(id: string): Sub {
    let s = this.subs.get(id);
    if (!s) {
      s = { status: 'aucun', launch_member: false, launch_until: null, current_period_end: null, method_label: null, cancel_at_period_end: false, charges: [] };
      this.subs.set(id, s);
    }
    return s;
  }

  hasAccess(id: string): boolean {
    if (!this.required) return true;
    const s = this.subs.get(id);
    if (!s || !['actif', 'impaye'].includes(s.status) || !s.current_period_end) return false;
    return s.cancel_at_period_end ? s.current_period_end > today() : s.current_period_end >= today();
  }

  private view(id: string): unknown {
    const s = this.sub(id);
    const taken = [...this.subs.values()].filter((x) => x.launch_member).length;
    return {
      required: this.required,
      has_access: this.hasAccess(id),
      status: s.status,
      price_cents: this.priceCents,
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
    if (st && GATED_RPC.has(fn) && !this.hasAccess(st.id)) return pg(400, 'P0001', 'subscription_required');
    return null;
  }

  /** Edge Function billing-checkout : page de paiement Mollie (simulée). */
  checkout(st: StackerInfo | null): Reply {
    if (!st) return [401, { ok: false, error: 'unauthorized' }];
    if (!st.onboarded) return [403, { ok: false, error: 'onboarding_required' }];
    const s = this.sub(st.id);
    if (s.status === 'actif' && (s.current_period_end ?? '') >= today()) return [409, { ok: false, error: 'already_active' }];
    if (s.status === 'aucun' || s.status === 'resilie') s.status = 'en_attente';
    for (const c of s.charges) if (c.status === 'en_attente') c.status = 'echoue';
    s.charges.push({ period_start: today(), amount_cents: this.priceCents, method: 'mollie', status: 'en_attente', created_at: new Date().toISOString(), payment: `tr_e2e${String(++this.seq)}` });
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
