import { describe, expect, it } from 'vitest';
import { CGV_VERSION } from '@shared/legal';
import { ApiError } from './apiError';
import { BillingError, billingErrorMessage, billingView, fetchBilling, needsSubscription, setAutoRenew, setPlan, startCheckout, type Billing } from './billing';
import type { Backend } from './supabase';

const BASE: Billing = {
  required: true,
  has_access: false,
  has_academy: false,
  status: 'aucun',
  plan: 'duo',
  pending_plan: null,
  prices: { academy: 1299, pro: 999, duo: 1499 },
  price_cents: 1499,
  launch_member: false,
  launch_until: null,
  launch_seats_left: 100,
  launch_priority: false,
  current_period_end: null,
  method_label: null,
  cancel_at_period_end: false,
  charges: [],
};

describe('état affiché', () => {
  it('offre, actif, résilié, impayé, paiement en attente', () => {
    expect(billingView(BASE)).toBe('offer');
    expect(billingView({ ...BASE, status: 'actif' })).toBe('active');
    expect(billingView({ ...BASE, status: 'actif', cancel_at_period_end: true })).toBe('ending');
    expect(billingView({ ...BASE, status: 'impaye' })).toBe('unpaid');
    expect(billingView({ ...BASE, status: 'en_attente' })).toBe('offer');
    expect(billingView({ ...BASE, status: 'en_attente', charges: [{ period_start: '2026-10-20', amount_cents: 699, method: 'mollie', status: 'en_attente', created_at: 'x' }] })).toBe('pending');
    expect(billingView({ ...BASE, status: 'resilie' })).toBe('offer');
  });
  it('bandeau seulement si l’abonnement est exigé et absent', () => {
    expect(needsSubscription(undefined)).toBe(false);
    expect(needsSubscription(BASE)).toBe(true);
    expect(needsSubscription({ ...BASE, required: false })).toBe(false);
    expect(needsSubscription({ ...BASE, has_access: true })).toBe(false);
  });
  it('messages', () => {
    expect(billingErrorMessage(new BillingError('already_active'))).toMatch(/déjà actif/);
    expect(billingErrorMessage(new BillingError('terms_outdated'))).toMatch(/recharge la page/);
    expect(billingErrorMessage(new BillingError('inconnu'))).toMatch(/momentanément/);
    expect(billingErrorMessage(new ApiError('network'))).toMatch(/Connexion impossible/);
    expect(billingErrorMessage(new ApiError('server'))).toMatch(/momentanément/);
    expect(billingErrorMessage(new Error('x'))).toMatch(/momentanément/);
  });
});

describe('appels serveur', () => {
  const calls: { fn: string; args: unknown }[] = [];
  const b = (data: unknown, error: { code?: string; message?: string } | null = null, status = 200, token: string | null = 'jwt') =>
    ({
      url: 'https://proj.supabase.co',
      anonKey: 'anon',
      accessToken: async () => token,
      db: {
        rpc: async (fn: string, args: unknown) => {
          calls.push({ fn, args });
          return { data, error, status };
        },
      },
    }) as unknown as Backend;

  it('my_billing et résiliation', async () => {
    await expect(fetchBilling(b(BASE))).resolves.toEqual(BASE);
    await expect(setAutoRenew(b({ ...BASE, cancel_at_period_end: true }), false)).resolves.toMatchObject({ cancel_at_period_end: true });
    await expect(setPlan(b({ ...BASE, pending_plan: 'pro' }), 'pro')).resolves.toMatchObject({ pending_plan: 'pro' });
    expect(calls.slice(-3)).toEqual([
      { fn: 'my_billing', args: {} },
      { fn: 'billing_set_auto_renew', args: { p_on: false } },
      { fn: 'billing_set_plan', args: { p_plan: 'pro' } },
    ]);
    await expect(fetchBilling(b({ nope: 1 }))).rejects.toMatchObject({ kind: 'server' });
    await expect(setAutoRenew(b(null, { code: 'P0002', message: 'no_subscription' }, 404), false)).rejects.toMatchObject({ code: 'no_subscription' });
    await expect(fetchBilling(b(null, { message: 'Failed to fetch' }, 0))).rejects.toMatchObject({ kind: 'network' });
    await expect(fetchBilling(b(null, { code: 'PGRST301', message: 'JWT expired' }, 401))).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(fetchBilling(b(null, { message: 'Erreur interne' }, 500))).rejects.toMatchObject({ kind: 'server' });
  });

  it('page de paiement : uniquement mollie.com en https', async () => {
    const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
    const seen: RequestInit[] = [];
    const ok = await startCheckout(b(null), 'duo', async (_u, init) => {
      seen.push(init ?? {});
      return new Response(JSON.stringify({ ok: true, url: 'https://www.mollie.com/checkout/abc' }));
    });
    expect(ok).toBe('https://www.mollie.com/checkout/abc');
    expect(seen[0]?.headers).toMatchObject({ Authorization: 'Bearer jwt', apikey: 'anon' });
    expect(JSON.parse(seen[0]?.body as string)).toEqual({ accept_terms: true, immediate_start: true, terms_version: CGV_VERSION, plan: 'duo' });
    await expect(startCheckout(b(null), 'duo', reply(200, { ok: true, url: 'https://evil.example/pay' }))).rejects.toMatchObject({ kind: 'server' });
    await expect(startCheckout(b(null), 'duo', reply(200, { ok: true, url: 'http://www.mollie.com/x' }))).rejects.toMatchObject({ kind: 'server' });
    await expect(startCheckout(b(null), 'duo', reply(409, { ok: false, error: 'already_active' }))).rejects.toMatchObject({ code: 'already_active' });
    await expect(startCheckout(b(null), 'duo', reply(401, { ok: false, error: 'unauthorized' }))).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(startCheckout(b(null), 'duo', reply(500, 'oups'))).rejects.toMatchObject({ kind: 'server' });
    await expect(startCheckout(b(null, null, 200, null), 'duo')).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(
      startCheckout(b(null), 'duo', async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).rejects.toMatchObject({ kind: 'network' });
  });
});
