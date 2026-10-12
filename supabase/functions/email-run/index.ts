// Edge Function Supabase (Deno) : email-run. Toute la logique est dans handler.ts (testée par Vitest).
import { loadEmailConfig } from './config.ts';
import { createHandler } from './handler.ts';

const handler = createHandler({
  config: loadEmailConfig(Deno.env.toObject()),
  fetch: (input, init) => fetch(input, init),
  log: (event, data) => console.log(JSON.stringify({ fn: 'email-run', event, ...data })),
});

Deno.serve(handler);
