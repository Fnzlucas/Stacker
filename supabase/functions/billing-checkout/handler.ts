/**
 * Abonnement stacker : ouvre la page de paiement Mollie du premier mois.
 * Identité tirée du jeton (jamais du corps). Le premier paiement crée un
 * mandat Mollie qui sert aux renouvellements quand les gains ne suffisent pas.
 * L'activation n'a lieu qu'à la confirmation du paiement (mollie-webhook).
 */
import { z } from 'zod';
import { callRpc, fetchAuthUser, RpcError, type FetchLike } from '../_shared/rest.ts';
import { bearer, corsHeaders, jsonResponse } from '../_shared/http.ts';
import { createMollie, MollieError, mollieAmount, type BillingConfigResult } from '../_shared/mollie.ts';

export interface HandlerDeps {
  config: BillingConfigResult;
  fetch: FetchLike;
  log: (event: string, data?: Record<string, string | number | boolean | string[]>) => void;
  mollieBase?: string;
}

const prepareSchema = z.object({
  customer_id: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  amount_cents: z.number().int().positive(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const KNOWN: Record<string, number> = { already_active: 409, onboarding_required: 403 };

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  if (!deps.config.ok) deps.log('config_invalid', { variables: deps.config.missing });
  return async function handle(req: Request): Promise<Response> {
    if (!deps.config.ok) return jsonResponse(503, { ok: false, error: 'unavailable' });
    const config = deps.config.config;
    const anonKey = config.anonKey;
    if (!anonKey) return jsonResponse(503, { ok: false, error: 'unavailable' });
    const origin = req.headers.get('origin');
    if (!origin || !config.allowedOrigins.has(origin)) return jsonResponse(403, { ok: false, error: 'forbidden_origin' });
    const cors = corsHeaders(origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'method_not_allowed' }, cors);
    const token = bearer(req);
    if (!token) return jsonResponse(401, { ok: false, error: 'unauthorized' }, cors);
    const rpc = (fn: string, args: Record<string, unknown>) => callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, fn, args);
    const mollie = createMollie(deps.fetch, config.mollieKey, deps.mollieBase);
    try {
      const user = await fetchAuthUser(deps.fetch, config.supabaseUrl, anonKey, token);
      if (!user) return jsonResponse(401, { ok: false, error: 'unauthorized' }, cors);
      let prep: z.infer<typeof prepareSchema>;
      try {
        prep = prepareSchema.parse(await rpc('billing_checkout_prepare', { p_stacker: user.id }));
      } catch (error) {
        const code = error instanceof RpcError ? error.message : '';
        const status = KNOWN[code];
        if (status) return jsonResponse(status, { ok: false, error: code }, cors);
        throw error;
      }
      let customer = prep.customer_id;
      if (!customer) {
        customer = await mollie.createCustomer({ name: prep.name, email: prep.email, metadata: { stacker_id: user.id } }, `stacker-${user.id}-customer`);
        await rpc('billing_set_customer', { p_stacker: user.id, p_customer: customer });
      }
      const payment = await mollie.createPayment(
        {
          amount: mollieAmount(prep.amount_cents),
          description: 'Abonnement Stacker — 1er mois',
          sequenceType: 'first',
          customerId: customer,
          redirectUrl: `${config.siteUrl}/app/abonnement?retour=1`,
          webhookUrl: config.webhookUrl,
          locale: 'fr_FR',
          metadata: { kind: 'stacker', charge: 'premier', stacker_id: user.id, period: prep.period_start },
        },
        crypto.randomUUID(),
      );
      const href = payment._links?.checkout?.href;
      if (!href || new URL(href).hostname.split('.').slice(-2).join('.') !== 'mollie.com') throw new MollieError(502, null, 'checkout manquant');
      await rpc('billing_charge_created', { p_stacker: user.id, p_kind: 'premier', p_period: prep.period_start, p_amount: prep.amount_cents, p_payment: payment.id });
      deps.log('checkout_created', { test: config.testMode });
      return jsonResponse(200, { ok: true, url: href }, cors);
    } catch (error) {
      deps.log('server_error', {
        reason: error instanceof RpcError ? `rpc_${String(error.status)}` : error instanceof MollieError ? `mollie_${String(error.status)}` : error instanceof z.ZodError ? 'invalid_payload' : 'exception',
      });
      return jsonResponse(502, { ok: false, error: 'payment_unavailable' }, cors);
    }
  };
}
