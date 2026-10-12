import { describe, expect, it } from 'vitest';
import { centsOf, createMollie, loadBillingConfig, methodLabel, MollieError, mollieAmount, parisDate, type MolliePayment } from './mollie.ts';

const KEY = 'test_abcdefghijklmnopqrstuvwxyz1234';
const ENV = {
  SUPABASE_URL: 'https://proj.supabase.co/',
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-factice-pour-les-tests',
  SITE_URL: 'https://stacker.example/',
  MOLLIE_API_KEY: KEY,
};
const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('configuration', () => {
  it('clé test_ ou live_, URL du webhook dérivée', () => {
    const c = loadBillingConfig(ENV);
    expect(c.ok && c.config).toMatchObject({ testMode: true, webhookUrl: 'https://proj.supabase.co/functions/v1/mollie-webhook', siteUrl: 'https://stacker.example', anonKey: null, cronSecret: null });
    const live = loadBillingConfig({ ...ENV, MOLLIE_API_KEY: ['live', 'abcdefghijklmnopqrstuvwxyz1234'].join('_'), ALLOWED_ORIGINS: 'https://a.fr, https://b.fr' });
    expect(live.ok && live.config.testMode).toBe(false);
    expect(live.ok && [...live.config.allowedOrigins]).toEqual(['https://a.fr', 'https://b.fr']);
    expect(loadBillingConfig({ ...ENV, MOLLIE_API_KEY: 'pas-une-cle' })).toEqual({ ok: false, missing: ['MOLLIE_API_KEY'] });
  });
});

describe('montants et dates', () => {
  it('format Mollie aller-retour', () => {
    expect(mollieAmount(699)).toEqual({ currency: 'EUR', value: '6.99' });
    expect(mollieAmount(150000).value).toBe('1500.00');
    expect(centsOf({ value: '6.99' })).toBe(699);
    expect(centsOf({ value: '10' })).toBe(1000);
    expect(centsOf({ value: '0.5' })).toBe(50);
    expect(centsOf({ value: '-6.99' })).toBe(-699);
    expect(centsOf(null)).toBe(0);
  });
  it('jour à Paris', () => {
    expect(parisDate('2026-10-31T23:30:00Z')).toBe('2026-11-01');
    expect(parisDate('2026-07-01T10:00:00Z')).toBe('2026-07-01');
    expect(parisDate(null, new Date('2026-01-15T12:00:00Z'))).toBe('2026-01-15');
    expect(parisDate('n’importe quoi', new Date('2026-01-15T12:00:00Z'))).toBe('2026-01-15');
  });
  it('libellé du moyen de paiement sans numéro complet', () => {
    const p = (x: Partial<MolliePayment>) => ({ id: 'tr_1', status: 'paid', amount: { value: '1', currency: 'EUR' }, ...x }) as MolliePayment;
    expect(methodLabel(p({ details: { cardNumber: '4242' } }))).toBe('Carte •••• 4242');
    expect(methodLabel(p({ details: { consumerAccount: 'NL55 INGB 0000 0000 00' } }))).toBe('Compte •••• 0000');
    expect(methodLabel(p({ method: 'creditcard' }))).toBe('Carte bancaire');
    expect(methodLabel(p({ method: 'paypal' }))).toBe('paypal');
    expect(methodLabel(p({}))).toBeNull();
  });
});

describe('client API', () => {
  const calls: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = [];
  const mollie = (responder: (url: string, method: string) => Response) =>
    createMollie(async (url, init) => {
      calls.push({ method: init?.method ?? 'GET', url, headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return responder(url, init?.method ?? 'GET');
    }, KEY);

  it('appels authentifiés, idempotents, corps attendus', async () => {
    calls.length = 0;
    const m = mollie((url) => {
      if (url.endsWith('/customers')) return json(201, { id: 'cst_1' });
      if (url.endsWith('/mandates')) return json(201, { id: 'mdt_1' });
      if (url.endsWith('/subscriptions')) return json(201, { id: 'sub_1' });
      return json(201, { id: 'tr_1', status: 'open', amount: { value: '6.99', currency: 'EUR' }, _links: { checkout: { href: 'https://www.mollie.com/checkout/x' } } });
    });
    expect(await m.createCustomer({ name: null, email: 'a@b.fr', metadata: { k: 'v' } }, 'k1')).toBe('cst_1');
    expect(await m.createMandate('cst_1', { consumerName: 'X', consumerAccount: 'FR76', signatureDate: '2026-10-12', mandateReference: 'STKM1' }, 'k2')).toBe('mdt_1');
    expect(await m.createSubscription('cst_1', { interval: '1 month' }, 'k3')).toBe('sub_1');
    expect((await m.createPayment({ amount: mollieAmount(699) }, 'k4'))._links?.checkout?.href).toContain('mollie.com');
    expect((await m.getPayment('tr_1')).status).toBe('open');
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://api.mollie.com/v2/customers', body: { email: 'a@b.fr', metadata: { k: 'v' } } });
    expect(calls[0]?.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, 'Idempotency-Key': 'k1' });
    expect(calls[1]?.body).toMatchObject({ method: 'directdebit', consumerAccount: 'FR76', mandateReference: 'STKM1' });
    expect(calls[4]).toMatchObject({ method: 'GET', url: 'https://api.mollie.com/v2/payments/tr_1' });
    expect(calls[4]?.headers['Idempotency-Key']).toBeUndefined();
  });

  it('erreurs : détail, champ, définitive ou non ; arrêt d’abonnement idempotent', async () => {
    const err = await mollie(() => json(422, { status: 422, detail: 'IBAN invalide', field: 'consumerAccount' }))
      .createMandate('cst', { consumerName: 'X', consumerAccount: 'x', signatureDate: '2026-10-12', mandateReference: 'R' }, 'k')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MollieError);
    expect(err).toMatchObject({ status: 422, field: 'consumerAccount', message: 'IBAN invalide', final: true });
    const down = await mollie(() => new Response('oups', { status: 503 }))
      .getPayment('tr_1')
      .catch((e: unknown) => e);
    expect(down).toMatchObject({ status: 503, field: null, final: false });
    await expect(mollie(() => json(204, null)).cancelSubscription('cst', 'sub')).resolves.toBeUndefined();
    await expect(mollie(() => json(404, { detail: 'x' })).cancelSubscription('cst', 'sub')).resolves.toBeUndefined();
    await expect(mollie(() => json(500, { detail: 'x' })).cancelSubscription('cst', 'sub')).rejects.toMatchObject({ status: 500 });
    await expect(mollie(() => json(200, { pas: 'un paiement' })).getPayment('tr_1')).rejects.toThrow();
  });
});
