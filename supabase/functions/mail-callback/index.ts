// Edge Function Supabase (Deno) : mail-callback. Toute la logique est dans handler.ts (testée par Vitest).
import { loadMailConfig } from '../_shared/mailConfig.ts';
import { createHandler } from './handler.ts';

const handler = createHandler({
  config: loadMailConfig(Deno.env.toObject()),
  fetch: (input, init) => fetch(input, init),
  log: (event, data) => console.log(JSON.stringify({ fn: 'mail-callback', event, ...data })),
});

Deno.serve(handler);
