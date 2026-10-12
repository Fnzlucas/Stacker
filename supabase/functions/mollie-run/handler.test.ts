import { describe, expect, it } from 'vitest';
import { loadBillingConfig } from '../_shared/mollie.ts';
import { createHandler as createRun } from './handler.ts';
import { createHandler as createCheckout } from '../billing-checkout/handler.ts';
import { createHandler as createWebhook } from '../mollie-webhook/handler.ts';

const SB = 'https://proj.supabase.co';
const ORIGIN = 'https://stacker.example';
const SECRET = 'secret-de-planification-0123456789';
const USER = '11111111-1111-4111-8111-111111111111';
const DEAL = '22222222-2222-4222-8222-222222222222';
const ENV = {
  SUPABASE_URL: SB,
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-factice-pour-les-tests',
  SUPABASE_ANON_KEY: 'sb_publishable_test_anon_key_1234',
  SITE_URL: 'https://stacker.example',
  ALLOWED_ORIGINS: ORIGIN,
  MOLLIE_API_KEY: 'test_abcdefghijklmnopqrstuvwxyz1234',
  CRON_SECRET: SECRET,
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const pgError = (message: string) => json(400, { code: 'P0001', message });

type Responder = (body: Record<string, unknown>) => Response;
interface World {
  rpc?: Record<string, Responder>;
  mollie?: (path: string, method: string, body: Record<string, unknown> | undefined) => Response;
  user?: Response;
}
function world(w: World) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const mollieCalls: { path: string; method: string; body: Record<string, unknown> | undefined; key: string | undefined }[] = [];
  const logs: string[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined;
    if (url === `${SB}/auth/v1/user`) return w.user ?? json(200, { id: USER, email: 'ines@exemple.fr' });
    if (url.startsWith(`${SB}/rest/v1/rpc/`)) {
      const fn = url.slice(`${SB}/rest/v1/rpc/`.length);
      rpcCalls.push({ fn, args: body ?? {} });
      return w.rpc?.[fn]?.(body ?? {}) ?? json(200, null);
    }
    const path = url.replace('https://api.mollie.com/v2', '');
    const method = init?.method ?? 'GET';
    mollieCalls.push({ path, method, body, key: (init?.headers as Record<string, string>)['Idempotency-Key'] });
    return w.mollie?.(path, method, body) ?? json(500, {});
  };
  const deps = { config: loadBillingConfig(ENV), fetch: fetchFn, log: (e: string) => void logs.push(e) };
  return { rpcCalls, mollieCalls, logs, deps };
}

const PAYMENT = { id: 'tr_abcd1', status: 'open', amount: { value: '6.99', currency: 'EUR' }, _links: { checkout: { href: 'https://www.mollie.com/checkout/select-method/abcd' } } };

describe('billing-checkout', () => {
  const prep = (customer: string | null = null) => () => json(200, { customer_id: customer, name: 'Inès Martin', email: 'ines@exemple.fr', amount_cents: 699, period_start: '2026-10-20' });
  const call = (w: ReturnType<typeof world>, opts: { origin?: string; auth?: string | null; method?: string; env?: Record<string, string | undefined> } = {}) => {
    const handle = createCheckout({ ...w.deps, config: loadBillingConfig(opts.env ?? ENV) });
    const headers = new Headers({ origin: opts.origin ?? ORIGIN });
    if (opts.auth !== null) headers.set('authorization', opts.auth ?? 'Bearer a.b.c');
    return handle(new Request(`${SB}/functions/v1/billing-checkout`, { method: opts.method ?? 'POST', headers }));
  };

  it('nouveau client : client Mollie, premier paiement, URL de paiement', async () => {
    const w = world({ rpc: { billing_checkout_prepare: prep() }, mollie: (path) => (path === '/customers' ? json(201, { id: 'cst_1' }) : json(201, PAYMENT)) });
    const r = await call(w);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, url: PAYMENT._links.checkout.href });
    expect(w.rpcCalls.map((c) => c.fn)).toEqual(['billing_checkout_prepare', 'billing_set_customer', 'billing_charge_created']);
    expect(w.rpcCalls[0]?.args).toEqual({ p_stacker: USER });
    expect(w.rpcCalls[2]?.args).toEqual({ p_stacker: USER, p_kind: 'premier', p_period: '2026-10-20', p_amount: 699, p_payment: 'tr_abcd1' });
    expect(w.mollieCalls[0]?.key).toBe(`stacker-${USER}-customer`);
    expect(w.mollieCalls[1]?.body).toMatchObject({
      amount: { currency: 'EUR', value: '6.99' },
      sequenceType: 'first',
      customerId: 'cst_1',
      redirectUrl: 'https://stacker.example/app/abonnement?retour=1',
      webhookUrl: `${SB}/functions/v1/mollie-webhook`,
      metadata: { kind: 'stacker', charge: 'premier', stacker_id: USER, period: '2026-10-20' },
    });
  });

  it('client existant réutilisé', async () => {
    const w = world({ rpc: { billing_checkout_prepare: prep('cst_9') }, mollie: () => json(201, PAYMENT) });
    expect((await call(w)).status).toBe(200);
    expect(w.mollieCalls.map((c) => c.path)).toEqual(['/payments']);
    expect(w.mollieCalls[0]?.body).toMatchObject({ customerId: 'cst_9' });
  });

  it('refus et erreurs', async () => {
    const ok = world({ rpc: { billing_checkout_prepare: prep('cst_9') }, mollie: () => json(201, PAYMENT) });
    expect((await call(ok, { origin: 'https://pirate.example' })).status).toBe(403);
    expect((await call(ok, { method: 'OPTIONS' })).status).toBe(204);
    expect((await call(ok, { method: 'GET' })).status).toBe(405);
    expect((await call(ok, { auth: null })).status).toBe(401);
    expect((await call(world({ user: json(401, {}) }))).status).toBe(401);
    expect((await call(ok, { env: { ...ENV, MOLLIE_API_KEY: undefined } })).status).toBe(503);
    expect((await call(ok, { env: { ...ENV, SUPABASE_ANON_KEY: undefined } })).status).toBe(503);
    const active = await call(world({ rpc: { billing_checkout_prepare: () => pgError('already_active') } }));
    expect(active.status).toBe(409);
    expect(await active.json()).toEqual({ ok: false, error: 'already_active' });
    expect((await call(world({ rpc: { billing_checkout_prepare: () => pgError('onboarding_required') } }))).status).toBe(403);
    expect((await call(world({ rpc: { billing_checkout_prepare: () => pgError('autre') } }))).status).toBe(502);
    const down = world({ rpc: { billing_checkout_prepare: prep('cst_9') }, mollie: () => json(503, {}) });
    expect(await (await call(down)).json()).toEqual({ ok: false, error: 'payment_unavailable' });
    expect(down.logs).toContain('server_error');
    // Une URL de paiement hors de mollie.com n'est jamais renvoyée.
    const evil = world({ rpc: { billing_checkout_prepare: prep('cst_9') }, mollie: () => json(201, { ...PAYMENT, _links: { checkout: { href: 'https://evil.example/pay' } } }) });
    expect((await call(evil)).status).toBe(502);
    expect(evil.rpcCalls.map((c) => c.fn)).not.toContain('billing_charge_created');
    const bad = world({ rpc: { billing_checkout_prepare: () => json(200, { nope: true }) } });
    expect((await call(bad)).status).toBe(502);
  });
});

describe('mollie-webhook', () => {
  const hook = (w: ReturnType<typeof world>, body = 'id=tr_abcd1', opts: { method?: string; env?: Record<string, string | undefined>; length?: string } = {}) => {
    const handle = createWebhook({ ...w.deps, config: loadBillingConfig(opts.env ?? ENV) });
    const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
    if (opts.length) headers.set('content-length', opts.length);
    return handle(new Request(`${SB}/functions/v1/mollie-webhook`, { method: opts.method ?? 'POST', headers, body: opts.method === 'GET' ? undefined : body }));
  };
  const pay = (x: Record<string, unknown>) => () => json(200, { id: 'tr_abcd1', amount: { value: '69.99', currency: 'EUR' }, ...x });
  const stackerMeta = { kind: 'stacker', charge: 'premier', stacker_id: USER, period: '2026-10-20' };

  it('paiement client payé : commission enregistrée au jour de Paris', async () => {
    const w = world({ mollie: pay({ status: 'paid', subscriptionId: 'sub_1', paidAt: '2026-10-31T23:30:00+00:00' }) });
    expect((await hook(w)).status).toBe(200);
    expect(w.mollieCalls[0]).toMatchObject({ path: '/payments/tr_abcd1', method: 'GET' });
    expect(w.rpcCalls).toEqual([{ fn: 'deal_payment_from_mollie', args: { p_subscription: 'sub_1', p_paid_on: '2026-11-01', p_amount_cents: 6999, p_payment: 'tr_abcd1' } }]);
  });

  it('paiement client refusé, contesté, abonnement inconnu, en cours', async () => {
    const failed = world({ mollie: pay({ status: 'failed', subscriptionId: 'sub_1', details: { bankReasonCode: 'AM04' } }) });
    await hook(failed);
    expect(failed.rpcCalls).toEqual([{ fn: 'deal_payment_failed_from_mollie', args: { p_subscription: 'sub_1', p_reason: 'AM04' } }]);
    const back = world({ mollie: pay({ status: 'paid', subscriptionId: 'sub_1', amountChargedBack: { value: '69.99', currency: 'EUR' } }) });
    await hook(back);
    expect(back.rpcCalls).toEqual([{ fn: 'deal_payment_reversed', args: { p_payment: 'tr_abcd1' } }]);
    const unknown = world({ mollie: pay({ status: 'paid', subscriptionId: 'sub_x' }), rpc: { deal_payment_from_mollie: () => json(404, { code: 'P0002', message: 'not_found' }) } });
    expect((await hook(unknown)).status).toBe(200);
    expect(unknown.logs).toContain('unknown_subscription');
    const pending = world({ mollie: pay({ status: 'pending', subscriptionId: 'sub_1' }) });
    expect((await hook(pending)).status).toBe(200);
    expect(pending.rpcCalls).toEqual([]);
  });

  it('abonnement stacker : payé, échoué, contesté', async () => {
    const paid = world({ mollie: pay({ status: 'paid', amount: { value: '6.99', currency: 'EUR' }, mandateId: 'mdt_1', details: { cardNumber: '4242' }, metadata: stackerMeta }) });
    expect((await hook(paid)).status).toBe(200);
    expect(paid.rpcCalls).toEqual([
      { fn: 'billing_charge_created', args: { p_stacker: USER, p_kind: 'premier', p_period: '2026-10-20', p_amount: 699, p_payment: 'tr_abcd1' } },
      { fn: 'billing_payment_paid', args: { p_payment: 'tr_abcd1', p_mandate: 'mdt_1', p_method_label: 'Carte •••• 4242' } },
    ]);
    const expired = world({ mollie: pay({ status: 'expired', metadata: { ...stackerMeta, charge: 'mensuel' } }) });
    await hook(expired);
    expect(expired.rpcCalls.map((c) => c.fn)).toEqual(['billing_charge_created', 'billing_payment_failed']);
    const back = world({ mollie: pay({ status: 'paid', amountChargedBack: { value: '6.99', currency: 'EUR' }, metadata: stackerMeta }) });
    await hook(back);
    expect(back.rpcCalls.map((c) => c.fn)).toEqual(['billing_charge_created']);
    expect(back.logs).toContain('stacker_chargeback');
    const open = world({ mollie: pay({ status: 'open', metadata: stackerMeta }) });
    await hook(open);
    expect(open.rpcCalls.map((c) => c.fn)).toEqual(['billing_charge_created']);
  });

  it('paiement inconnu ou étranger ignoré ; corps invalide refusé ; panne → Mollie réessaie', async () => {
    const other = world({ mollie: pay({ status: 'paid', metadata: { order: 42 } }) });
    expect((await hook(other)).status).toBe(200);
    expect(other.rpcCalls).toEqual([]);
    const missing = world({ mollie: () => json(404, { detail: 'not found' }) });
    expect((await hook(missing)).status).toBe(200);
    expect(missing.logs).toContain('unknown_payment');
    expect((await hook(world({}), 'id=../../customers')).status).toBe(400);
    expect((await hook(world({}), '')).status).toBe(400);
    expect((await hook(world({}), 'id=tr_abcd1', { length: '5000' })).status).toBe(413);
    expect((await hook(world({}), '', { method: 'GET' })).status).toBe(405);
    expect((await hook(world({}), 'id=tr_abcd1', { env: { ...ENV, MOLLIE_API_KEY: 'x' } })).status).toBe(503);
    expect((await hook(world({ mollie: () => json(503, {}) }))).status).toBe(502);
    expect((await hook(world({ mollie: () => json(200, { id: 'tr_abcd1' }) }))).status).toBe(502);
    const dbDown = world({ mollie: pay({ status: 'paid', subscriptionId: 'sub_1' }), rpc: { deal_payment_from_mollie: () => json(500, {}) } });
    expect((await hook(dbDown)).status).toBe(500);
  });
});

describe('mollie-run', () => {
  const run = (w: ReturnType<typeof world>, opts: { secret?: string; method?: string; env?: Record<string, string | undefined> } = {}) => {
    const handle = createRun({ ...w.deps, config: loadBillingConfig(opts.env ?? ENV) });
    return handle(new Request(`${SB}/functions/v1/mollie-run`, { method: opts.method ?? 'POST', headers: { 'x-cron-secret': opts.secret ?? SECRET } }));
  };
  const pending = (x: Record<string, unknown> = {}) => ({
    deal_id: DEAL,
    reference: 'STK-12345678',
    customer_id: null,
    mandate_id: null,
    company_name: 'Boulangerie Test',
    email: 'contact@boulangerie-test.fr',
    iban: 'FR7630006000011234567890189',
    iban_holder: 'Boulangerie Test',
    mandate_ref: 'STKM12345678',
    signed_on: '2026-10-12',
    first_debit_on: '2026-10-27',
    amount_cents: 6999,
    ...x,
  });

  it('client signé : client, mandat SEPA, abonnement mensuel après la rétractation', async () => {
    const w = world({
      rpc: { deal_mollie_pending: () => json(200, [pending()]), deal_mollie_cancels: () => json(200, []), billing_renew_due: () => json(200, []) },
      mollie: (path) => (path === '/customers' ? json(201, { id: 'cst_d' }) : path.endsWith('/mandates') ? json(201, { id: 'mdt_d' }) : json(201, { id: 'sub_d' })),
    });
    const r = await run(w);
    expect(await r.json()).toMatchObject({ ok: true, setup: 1, setup_failed: 0 });
    expect(w.mollieCalls.map((c) => [c.path, c.key])).toEqual([
      ['/customers', `deal-${DEAL}-customer`],
      ['/customers/cst_d/mandates', `deal-${DEAL}-mandate`],
      ['/customers/cst_d/subscriptions', `deal-${DEAL}-subscription`],
    ]);
    expect(w.mollieCalls[1]?.body).toEqual({ method: 'directdebit', consumerName: 'Boulangerie Test', consumerAccount: 'FR7630006000011234567890189', signatureDate: '2026-10-12', mandateReference: 'STKM12345678' });
    expect(w.mollieCalls[2]?.body).toMatchObject({ amount: { value: '69.99', currency: 'EUR' }, interval: '1 month', startDate: '2026-10-27', mandateId: 'mdt_d', description: 'Stacker STK-12345678', metadata: { kind: 'deal', deal_id: DEAL } });
    const progress = w.rpcCalls.filter((c) => c.fn === 'deal_mollie_progress').map((c) => c.args);
    expect(progress).toEqual([
      { p_deal: DEAL, p_customer: 'cst_d', p_mandate: null, p_subscription: null, p_first_debit: null },
      { p_deal: DEAL, p_customer: null, p_mandate: 'mdt_d', p_subscription: null, p_first_debit: null },
      { p_deal: DEAL, p_customer: null, p_mandate: null, p_subscription: 'sub_d', p_first_debit: '2026-10-27' },
    ]);
  });

  it('reprise après une étape réussie ; IBAN refusé : erreur définitive ; panne : réessai', async () => {
    const resume = world({
      rpc: { deal_mollie_pending: () => json(200, [pending({ customer_id: 'cst_d', mandate_id: 'mdt_d' })]), deal_mollie_cancels: () => json(200, []), billing_renew_due: () => json(200, []) },
      mollie: () => json(201, { id: 'sub_d' }),
    });
    await run(resume);
    expect(resume.mollieCalls.map((c) => c.path)).toEqual(['/customers/cst_d/subscriptions']);
    const refused = world({
      rpc: { deal_mollie_pending: () => json(200, [pending({ customer_id: 'cst_d' })]), deal_mollie_cancels: () => json(200, []), billing_renew_due: () => json(200, []) },
      mollie: () => json(422, { detail: 'invalid', field: 'consumerAccount' }),
    });
    expect(await (await run(refused)).json()).toMatchObject({ setup: 0, setup_failed: 1 });
    expect(refused.rpcCalls.find((c) => c.fn === 'deal_mollie_failed')?.args).toEqual({ p_deal: DEAL, p_error: 'mollie_422_consumerAccount', p_final: true });
    const down = world({
      rpc: { deal_mollie_pending: () => json(200, [pending()]), deal_mollie_cancels: () => json(200, []), billing_renew_due: () => json(200, []) },
      mollie: () => json(503, {}),
    });
    await run(down);
    expect(down.rpcCalls.find((c) => c.fn === 'deal_mollie_failed')?.args).toMatchObject({ p_error: 'mollie_503', p_final: false });
  });

  it('résiliations transmises ; renouvellements prélevés sur le mandat', async () => {
    const w = world({
      rpc: {
        deal_mollie_pending: () => json(200, []),
        deal_mollie_cancels: () => json(200, [
          { deal_id: DEAL, customer_id: 'cst_d', subscription_id: 'sub_d' },
          { deal_id: '33333333-3333-4333-8333-333333333333', customer_id: null, subscription_id: null },
        ]),
        billing_renew_due: () => json(200, [{ stacker_id: USER, customer_id: 'cst_s', mandate_id: 'mdt_s', period_start: '2026-11-20', amount_cents: 699 }]),
      },
      mollie: (_path, method) => (method === 'DELETE' ? json(200, {}) : json(201, { id: 'tr_renew1', status: 'pending', amount: { value: '6.99', currency: 'EUR' } })),
    });
    expect(await (await run(w)).json()).toMatchObject({ cancelled: 2, renew_requested: 1 });
    expect(w.mollieCalls.map((c) => [c.method, c.path])).toEqual([
      ['DELETE', '/customers/cst_d/subscriptions/sub_d'],
      ['POST', '/payments'],
    ]);
    expect(w.mollieCalls[1]?.body).toMatchObject({ sequenceType: 'recurring', customerId: 'cst_s', mandateId: 'mdt_s', metadata: { kind: 'stacker', charge: 'mensuel', stacker_id: USER, period: '2026-11-20' } });
    expect(w.mollieCalls[1]?.key).toBe(`renew-${USER}-2026-11-20`);
    expect(w.rpcCalls.find((c) => c.fn === 'billing_charge_created')?.args).toEqual({ p_stacker: USER, p_kind: 'mensuel', p_period: '2026-11-20', p_amount: 699, p_payment: 'tr_renew1' });
    expect(w.rpcCalls.filter((c) => c.fn === 'deal_mollie_cancelled')).toHaveLength(2);
  });

  it('échecs isolés, accès protégé, base indisponible', async () => {
    const w = world({
      rpc: {
        deal_mollie_pending: () => json(200, []),
        deal_mollie_cancels: () => json(200, [{ deal_id: DEAL, customer_id: 'cst_d', subscription_id: 'sub_d' }]),
        billing_renew_due: () => json(200, [{ stacker_id: USER, customer_id: 'cst_s', mandate_id: 'mdt_s', period_start: '2026-11-20', amount_cents: 699 }]),
      },
      mollie: () => json(500, {}),
    });
    expect(await (await run(w)).json()).toMatchObject({ ok: true, cancel_failed: 1, renew_failed: 1 });
    expect(w.logs).toContain('renew_failed');
    expect((await run(world({}), { secret: 'mauvais-secret' })).status).toBe(403);
    expect((await run(world({}), { method: 'GET' })).status).toBe(405);
    expect((await run(world({}), { env: { ...ENV, CRON_SECRET: undefined } })).status).toBe(503);
    expect((await run(world({}), { env: { ...ENV, MOLLIE_API_KEY: undefined } })).status).toBe(503);
    expect((await run(world({ rpc: { deal_mollie_pending: () => json(500, {}) } }))).status).toBe(500);
    expect((await run(world({ rpc: { deal_mollie_pending: () => json(200, [{ x: 1 }]) } }))).status).toBe(500);
  });
});
