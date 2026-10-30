// Edge Function Supabase (Deno) : roleplay. Toute la logique est dans handler.ts (testée par Vitest).
import { createAnthropic } from './ai.ts';
import { loadConfig } from './config.ts';
import { createHandler } from './handler.ts';

const fetchFn = (input: string, init?: RequestInit) => fetch(input, init);

const handler = createHandler({
  config: loadConfig(Deno.env.toObject()),
  fetch: fetchFn,
  ai: (apiKey, model) => createAnthropic(fetchFn, apiKey, model),
  log: (event, data) => console.log(JSON.stringify({ fn: 'roleplay', event, ...data })),
});

Deno.serve(handler);
