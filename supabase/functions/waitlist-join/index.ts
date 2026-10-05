// Edge Function Supabase (Deno) : inscription à la liste d'attente.
// Point d'entrée minimal : toute la logique est dans handler.ts (testée par Vitest).
import { loadConfig } from './config.ts';
import { createHandler } from './handler.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

const handler = createHandler({
  config: loadConfig(Deno.env.toObject()),
  fetch: (input, init) => fetch(input, init),
  waitUntil: (promise) => {
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(promise);
    else void promise;
  },
  // Journal structuré, sans donnée personnelle (voir handler.ts).
  log: (event, data) => console.log(JSON.stringify({ fn: 'waitlist-join', event, ...data })),
});

Deno.serve(handler);
