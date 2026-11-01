// Edge Function Supabase (Deno) : push-run. Toute la logique est dans handler.ts (testée par Vitest).
import { loadPushConfig } from './config.ts';
import { createHandler } from './handler.ts';

const handler = createHandler({
  config: loadPushConfig(Deno.env.toObject()),
  fetch: (input, init) => fetch(input, init),
  log: (event, data) => console.log(JSON.stringify({ fn: 'push-run', event, ...data })),
});

Deno.serve(handler);
