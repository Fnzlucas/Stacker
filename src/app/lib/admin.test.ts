import { describe, expect, it } from 'vitest';
import {
  AdminError,
  adminErrorMessage,
  fetchAdminDeals,
  fetchAdminOffers,
  fetchAdminPayouts,
  fetchAdminStackers,
  fetchIsAdmin,
  fetchOverview,
  groupIban,
  markPayout,
  setDealStatus,
  setFlag,
  setOfferActive,
} from './admin';
import { ApiError } from './apiError';
import type { Backend } from './supabase';

const OVERVIEW = {
  stackers: 3,
  signups_7d: 1,
  subscriptions: 2,
  subscriptions_unpaid: 0,
  launch_members: 2,
  launch_seats: 100,
  deals: { actif: 1 },
  deals_7d: 1,
  client_monthly_cents: 6999,
  payouts_pending: 1,
  payouts_pending_cents: 1049,
  commissions_available_cents: 0,
  mollie_errors: 0,
  emails_failed: 0,
  flags: { billing_required: false },
  log: [{ action: 'flag', target: 'billing_required', detail: { enabled: true }, created_at: '2026-10-12T10:00:00Z', admin: 'lucas@exemple.fr' }],
};

describe('admin', () => {
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
  const ID = '11111111-1111-4111-8111-111111111111';

  it('lectures : arguments et réponses validées', async () => {
    calls.length = 0;
    await expect(fetchIsAdmin(b(true))).resolves.toBe(true);
    await expect(fetchOverview(b(OVERVIEW))).resolves.toMatchObject({ stackers: 3 });
    await expect(fetchAdminPayouts(b([]), 'demande')).resolves.toEqual([]);
    await expect(fetchAdminDeals(b([]), 'actif', '  boulang ')).resolves.toEqual([]);
    await expect(fetchAdminDeals(b([]), null, '   ')).resolves.toEqual([]);
    await expect(fetchAdminOffers(b([]))).resolves.toEqual([]);
    await expect(fetchAdminStackers(b([]), '')).resolves.toEqual([]);
    await expect(fetchOverview(b({ stackers: 'x' }))).rejects.toMatchObject({ kind: 'server' });
    expect(calls.map((c) => [c.fn, c.args])).toEqual([
      ['is_admin', {}],
      ['admin_overview', {}],
      ['admin_payouts', { p_status: 'demande' }],
      ['admin_deals', { p_status: 'actif', p_search: 'boulang' }],
      ['admin_deals', { p_status: null, p_search: null }],
      ['admin_offers', {}],
      ['admin_stackers', { p_search: null }],
      ['admin_overview', {}],
    ]);
  });

  it('actions', async () => {
    calls.length = 0;
    await markPayout(b(null), ID, 'verse', '  ');
    await markPayout(b(null), ID, 'refuse', ' IBAN clôturé ');
    await setDealStatus(b(null), ID, 'resilie', ' demande du client ');
    await setOfferActive(b(null), 'alma-pro', false);
    await setFlag(b(null), 'billing_required', true);
    expect(calls.map((c) => c.args)).toEqual([
      { p_payout: ID, p_status: 'verse', p_note: null },
      { p_payout: ID, p_status: 'refuse', p_note: 'IBAN clôturé' },
      { p_deal: ID, p_status: 'resilie', p_reason: 'demande du client' },
      { p_offer: 'alma-pro', p_active: false },
      { p_key: 'billing_required', p_enabled: true },
    ]);
  });

  it('erreurs et messages', async () => {
    await expect(fetchOverview(b(null, { code: '42501', message: 'forbidden' }, 403))).rejects.toBeInstanceOf(AdminError);
    await expect(fetchOverview(b(null, { message: 'Failed to fetch' }, 0))).rejects.toMatchObject({ kind: 'network' });
    await expect(fetchOverview(b(null, { code: 'PGRST301', message: 'JWT expired' }, 401))).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(fetchOverview(b(null, { message: 'Erreur interne' }, 500))).rejects.toMatchObject({ kind: 'server' });
    expect(adminErrorMessage(new AdminError('forbidden'))).toMatch(/réservé/);
    expect(adminErrorMessage(new AdminError('autre'))).toMatch(/momentanément/);
    expect(adminErrorMessage(new ApiError('network'))).toMatch(/Connexion/);
    expect(adminErrorMessage(new ApiError('server'))).toMatch(/momentanément/);
    expect(adminErrorMessage(new Error('x'))).toMatch(/momentanément/);
    expect(groupIban('BE68539007547034')).toBe('BE68 5390 0754 7034');
    expect(groupIban('FR76 3000 6000 0112 3456 7890 189')).toBe('FR76 3000 6000 0112 3456 7890 189');
  });
});
