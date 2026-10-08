// Edge Function Supabase (Deno) : moteur de prospection (tâche planifiée, jamais appelée par le navigateur).
// Point d'entrée minimal : toute la logique est dans handler.ts (testée par Vitest).
import { loadConfig } from './config.ts';
import { createHandler } from './handler.ts';

const handler = createHandler({
  config: loadConfig(Deno.env.toObject()),
  fetch: (input, init) => fetch(input, init),
  // Garde SSRF : chaque hôte est résolu et refusé s'il pointe vers une adresse privée.
  resolve: async (host) => {
    const [a, aaaa] = await Promise.all([Deno.resolveDns(host, 'A').catch(() => []), Deno.resolveDns(host, 'AAAA').catch(() => [])]);
    return [...a, ...aaaa];
  },
  log: (event, data) => console.log(JSON.stringify({ fn: 'leads-enrich', event, ...data })),
});

Deno.serve(handler);
