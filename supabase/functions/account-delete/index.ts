// Edge Function Supabase (Deno) : suppression du compte de l'utilisateur connecté.
// Point d'entrée minimal : toute la logique est dans handler.ts (testée par Vitest).
import { loadConfig } from './config.ts';
import { createHandler } from './handler.ts';

const handler = createHandler({
  config: loadConfig(Deno.env.toObject()),
  fetch: (input, init) => fetch(input, init),
  // Journal structuré, sans donnée personnelle (voir handler.ts).
  log: (event, data) => console.log(JSON.stringify({ fn: 'account-delete', event, ...data })),
});

Deno.serve(handler);
