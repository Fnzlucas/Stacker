/**
 * Espace admin dans le faux Supabase des tests e2e : mêmes règles que la base
 * (supabase/migrations/20261015090000_admin.sql) — réservé aux admins,
 * motif obligatoire pour refuser ou résilier, journal des actions.
 */
import type { FakeBilling } from './fake-billing';
import type { FakeDeals } from './fake-deals';
import type { StackerInfo } from './fake-prospects';

type Reply = [number, unknown];
const pg = (status: number, code: string, message: string): Reply => [status, { code, message, details: null, hint: null }];

interface People {
  name(id: string): string | null;
  email(id: string): string | null;
  stackers(): { id: string; name: string | null; email: string; onboarded: boolean; created_at: string }[];
}

export class FakeAdmin {
  admins = new Set<string>();
  flags: Record<string, boolean> = { prospects_enabled: true, campaigns_enabled: true, leads_enrich_enabled: true };
  log: { action: string; target: string; detail: Record<string, unknown>; created_at: string; admin: string | null }[] = [];

  constructor(
    private readonly deals: FakeDeals,
    private readonly billing: FakeBilling,
    private readonly people: People,
  ) {}

  private audit(admin: string, action: string, target: string, detail: Record<string, unknown> = {}): void {
    this.log.unshift({ action, target, detail, created_at: new Date().toISOString(), admin: this.people.email(admin) });
  }

  rpc(fn: string, b: Record<string, unknown>, st: StackerInfo | null): Reply | null {
    if (fn === 'is_admin') return st ? [200, this.admins.has(st.id)] : pg(401, '42501', 'unauthorized');
    if (!fn.startsWith('admin_')) return null;
    if (!st || !this.admins.has(st.id)) return pg(403, '42501', 'forbidden');
    const text = (k: string) => (typeof b[k] === 'string' ? b[k].trim() : '');
    switch (fn) {
      case 'admin_overview': {
        const counts: Record<string, number> = {};
        for (const d of this.deals.deals) counts[d.status] = (counts[d.status] ?? 0) + 1;
        const pending = this.deals.payouts.filter((p) => p.status === 'demande');
        return [
          200,
          {
            stackers: this.people.stackers().filter((s) => s.onboarded).length,
            signups_7d: this.people.stackers().length,
            subscriptions: 0,
            subscriptions_unpaid: 0,
            launch_members: 0,
            launch_seats: this.billing.launchSeats,
            deals: counts,
            deals_7d: this.deals.deals.length,
            client_monthly_cents: this.deals.deals.filter((d) => d.status === 'actif').reduce((a, d) => a + d.monthly_price_cents, 0),
            payouts_pending: pending.length,
            payouts_pending_cents: pending.reduce((a, p) => a + p.amount_cents, 0),
            commissions_available_cents: 0,
            mollie_errors: 0,
            emails_failed: 0,
            flags: { ...this.flags, billing_required: this.billing.required },
            log: this.log.slice(0, 30),
          },
        ];
      }
      case 'admin_payouts':
        return [
          200,
          this.deals.payouts
            .filter((p) => p.status === b['p_status'])
            .map((p) => {
              const acc = this.deals.accounts.get(p.stacker);
              return {
                id: p.id,
                amount_cents: p.amount_cents,
                status: p.status,
                requested_at: p.requested_at,
                processed_at: p.processed_at,
                reference: p.reference ?? null,
                iban_last4: p.iban_last4,
                stacker_id: p.stacker,
                stacker_name: this.people.name(p.stacker),
                stacker_email: this.people.email(p.stacker),
                holder: acc?.holder ?? null,
                iban: p.status === 'demande' && acc?.iban_last4 === p.iban_last4 ? acc.iban : null,
              };
            }),
        ];
      case 'admin_payout_mark': {
        const p = this.deals.payouts.find((x) => x.id === b['p_payout']);
        const status = b['p_status'];
        if ((status !== 'verse' && status !== 'refuse') || (status === 'refuse' && text('p_note').length < 3)) return pg(400, '22023', 'invalid_request');
        if (!p) return pg(404, 'P0002', 'not_found');
        if (p.status !== 'demande') return pg(400, '22023', 'invalid_transition');
        p.status = status;
        p.processed_at = new Date().toISOString();
        p.reference = text('p_note') || null;
        for (const c of this.deals.commissions.filter((x) => x.payout_id === p.id)) {
          if (status === 'verse') c.status = 'versee';
          else {
            c.status = 'disponible';
            c.payout_id = null;
          }
        }
        this.audit(st.id, `payout_${status}`, p.id);
        return [204, null];
      }
      case 'admin_deals': {
        const q = text('p_search').toLowerCase();
        return [
          200,
          this.deals.deals
            .filter((d) => (!b['p_status'] || d.status === b['p_status']) && (!q || (d.input['company_name'] ?? '').toLowerCase().includes(q) || d.reference.toLowerCase().includes(q)))
            .map((d) => ({
              id: d.id,
              reference: d.reference,
              status: d.status,
              company_name: d.input['company_name'] ?? '',
              company_siret: d.input['siret'] ?? '',
              contact_email: d.input['email'] ?? '',
              contact_phone: d.input['phone'] ?? '',
              offer_label: `${d.offer.brand} · ${d.offer.name}`,
              monthly_price_cents: d.monthly_price_cents,
              signed_at: d.signed_at,
              activated_at: d.activated_at,
              ended_at: null,
              end_reason: null,
              mollie_status: 'a_faire',
              mollie_error: null,
              first_debit_on: null,
              payments: 0,
              stacker_name: this.people.name(d.stacker),
            })),
        ];
      }
      case 'admin_deal_set_status': {
        const d = this.deals.deals.find((x) => x.id === b['p_deal']);
        const status = b['p_status'];
        if ((status !== 'suspendu' && status !== 'resilie' && status !== 'annule') || text('p_reason').length < 3) return pg(400, '22023', 'invalid_request');
        if (!d) return pg(404, 'P0002', 'not_found');
        if (d.status === 'resilie' || d.status === 'annule') return pg(400, '55000', 'deal_closed');
        d.status = status;
        this.audit(st.id, `deal_${status}`, d.id, { reason: text('p_reason') });
        return [204, null];
      }
      case 'admin_offers':
        return [
          200,
          this.deals.offers.map((o) => ({
            id: o.id,
            brand: o.brand,
            name: o.name,
            category: o.category,
            price_cents: o.price_cents,
            unit_label: o.unit_label,
            engagement_months: o.engagement_months,
            active: o.active,
            deals: this.deals.deals.filter((d) => d.offer.id === o.id).length,
          })),
        ];
      case 'admin_offer_set_active': {
        const o = this.deals.offers.find((x) => x.id === b['p_offer']);
        if (!o) return pg(404, 'P0002', 'not_found');
        o.active = b['p_active'] === true;
        this.audit(st.id, o.active ? 'offer_on' : 'offer_off', o.id);
        return [204, null];
      }
      case 'admin_stackers': {
        const q = text('p_search').toLowerCase();
        return [
          200,
          this.people
            .stackers()
            .filter((s) => !q || s.email.includes(q) || (s.name ?? '').toLowerCase().includes(q))
            .map((s) => ({
              id: s.id,
              name: s.name,
              email: s.email,
              phone: null,
              department: null,
              tier: 'rookie',
              active_clients: 0,
              onboarded: s.onboarded,
              created_at: s.created_at,
              subscription: 'aucun',
              launch_member: false,
              period_end: null,
              deals: this.deals.deals.filter((d) => d.stacker === s.id).length,
              available_cents: 0,
            })),
        ];
      }
      case 'admin_set_flag': {
        const key = text('p_key');
        if (!['prospects_enabled', 'campaigns_enabled', 'leads_enrich_enabled', 'billing_required'].includes(key) || typeof b['p_enabled'] !== 'boolean') return pg(400, '22023', 'invalid_request');
        if (key === 'billing_required') this.billing.required = b['p_enabled'];
        else this.flags[key] = b['p_enabled'];
        this.audit(st.id, 'flag', key, { enabled: b['p_enabled'] });
        return [204, null];
      }
      default:
        return pg(404, 'PGRST202', `fonction inconnue : ${fn}`);
    }
  }
}
