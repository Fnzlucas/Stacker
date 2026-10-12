// Edge Function Supabase (Deno) : mollie-webhook. Toute la logique est dans handler.ts (testée par Vitest).
import { loadBillingConfig } from '../_shared/mollie.ts';
import { createHandler } from './handler.ts';

const handler = createHandler({
  config: loadBillingConfig(Deno.env.toObject()),
  fetch: (input, init) => fetch(input, init),
  log: (event, data) => console.log(JSON.stringify({ fn: 'mollie-webhook', event, ...data })),
});

Deno.serve(handler);
