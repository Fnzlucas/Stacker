import { describe, expect, it } from 'vitest';
import type { AiClient, Evaluation } from './ai.ts';
import { AiError } from './ai.ts';
import { DEFAULT_MODEL, loadConfig } from './config.ts';
import { createHandler } from './handler.ts';

const ORIGIN = 'https://stacker.example';
const URL_BASE = 'https://proj.supabase.co';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';

const ENV = {
  SUPABASE_URL: `${URL_BASE}/`,
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-factice-pour-les-tests',
  SUPABASE_ANON_KEY: 'sb_publishable_test_anon_key_1234',
  ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:4174`,
  ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789',
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const rpcError = (status: number, message: string) => json(status, { code: 'P0001', message });

const evaluation: Evaluation = {
  criteres: {
    presentation: { note: 18, commentaire: 'Clair.' },
    accroche: { note: 16, commentaire: 'Précise.' },
    decouverte: { note: 12, commentaire: 'Une seule question.' },
    offre: { note: 15, commentaire: 'Prix annoncé.' },
    conclusion: { note: 14, commentaire: 'Rendez-vous fixé.' },
  },
  points_forts: ['Accroche sur les horaires du dimanche'],
  a_ameliorer: ['Reformule avant de présenter l’offre'],
  phrase_cle: 'Si je comprends bien, des clients viennent pour rien le dimanche ?',
  resume: 'Bon appel, rendez-vous obtenu.',
  faute_grave: null,
  issue: 'rendez_vous',
};

interface Scenario {
  user?: Response;
  rpc?: Record<string, Response>;
  ai?: (input: Parameters<AiClient['complete']>[0]) => Promise<{ text: string; tokensIn: number; tokensOut: number }>;
  session?: Record<string, unknown>;
}

function setup(scenario: Scenario = {}, env: Record<string, string | undefined> = ENV) {
  const rpcCalls: { fn: string; body: Record<string, unknown> }[] = [];
  const aiCalls: Parameters<AiClient['complete']>[0][] = [];
  const logs: { event: string; data?: Record<string, unknown> }[] = [];
  const models: string[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (url === `${URL_BASE}/auth/v1/user`) return scenario.user ?? json(200, { id: USER_ID, email: 'ines@exemple.fr' });
    const m = /\/rest\/v1\/rpc\/(\w+)$/.exec(url);
    if (m?.[1]) {
      const fn = m[1];
      rpcCalls.push({ fn, body: JSON.parse(init?.body as string) as Record<string, unknown> });
      const custom = scenario.rpc?.[fn];
      if (custom) return custom;
      if (fn === 'roleplay_start') return json(200, { session_id: SESSION, max_chars: 600, max_turns: 24 });
      if (fn === 'roleplay_get')
        return json(200, {
          scenario: 'boulangerie',
          turns: [
            { role: 'prospect', text: 'Boulangerie Martin, bonjour !', at: '2026-10-30T10:00:00Z' },
            { role: 'stacker', text: 'Bonjour, Inès Martin pour Stacker.' },
            { role: 'prospect', text: 'Oui ?', hung_up: false },
          ],
          max_chars: 600,
          max_turns: 24,
          stacker_turns: 1,
          ...scenario.session,
        });
      if (fn === 'roleplay_append') return json(200, { turns: 5, max_turns: 24 });
      if (fn === 'roleplay_finish') {
        const score = (JSON.parse(init?.body as string) as { p_score: number }).p_score;
        return json(200, { score, passed: score >= 70, stacker_turns: 6, min_stacker_turns: 5, pass_score: 70 });
      }
    }
    return json(404, {});
  };
  const ai = (provider: string, _key: string, model: string): AiClient => {
    models.push(provider === 'anthropic' ? model : `${provider}:${model}`);
    return {
      complete: async (input) => {
        aiCalls.push(input);
        if (scenario.ai) return scenario.ai(input);
        return { text: 'Oui, je vous écoute.', tokensIn: 800, tokensOut: 12 };
      },
    };
  };
  const handle = createHandler({ config: loadConfig(env), fetch: fetchFn, ai, log: (event, data) => logs.push({ event, data }) });
  return { handle, rpcCalls, aiCalls, logs, models };
}

function request(body: unknown, opts: { origin?: string | null; auth?: string | null; method?: string; raw?: string; type?: string } = {}) {
  const headers = new Headers();
  if (opts.origin !== null) headers.set('origin', opts.origin ?? ORIGIN);
  if (opts.auth !== null) headers.set('authorization', opts.auth ?? `Bearer ${TOKEN}`);
  headers.set('content-type', opts.type ?? 'application/json');
  const method = opts.method ?? 'POST';
  return new Request(`${URL_BASE}/functions/v1/roleplay`, { method, headers, body: method === 'POST' ? (opts.raw ?? JSON.stringify(body)) : undefined });
}

const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

describe('configuration', () => {
  it('modèle par défaut, modèle choisi, variables manquantes', () => {
    const ok = loadConfig(ENV);
    expect(ok.ok && ok.config.model).toBe(DEFAULT_MODEL);
    const custom = loadConfig({ ...ENV, ROLEPLAY_MODEL: ' claude-sonnet-5-5 ' });
    expect(custom.ok && custom.config.model).toBe('claude-sonnet-5-5');
    expect(loadConfig({ ...ENV, ANTHROPIC_API_KEY: undefined })).toEqual({ ok: false, missing: ['ANTHROPIC_API_KEY'] });
    // Mistral : sa propre clé et son modèle par défaut.
    expect(loadConfig({ ...ENV, ROLEPLAY_PROVIDER: 'mistral' })).toEqual({ ok: false, missing: ['MISTRAL_API_KEY'] });
    const mistral = loadConfig({ ...ENV, ROLEPLAY_PROVIDER: ' mistral ', MISTRAL_API_KEY: 'mistral-test-key-0123456789' });
    expect(mistral.ok && [mistral.config.provider, mistral.config.apiKey, mistral.config.model]).toEqual(['mistral', 'mistral-test-key-0123456789', 'mistral-small-latest']);
    expect(loadConfig({ ...ENV, ROLEPLAY_PROVIDER: 'openai' }).ok).toBe(false);
    expect(loadConfig({ ...ENV, ALLOWED_ORIGINS: 'pas-une-origine' }).ok).toBe(false);
  });

  it('configuration incomplète : 503, seuls les noms sont journalisés', async () => {
    const { handle, logs } = setup({}, { ...ENV, ANTHROPIC_API_KEY: undefined });
    expect((await read(await handle(request({ action: 'start', scenario: 'garage' })))).status).toBe(503);
    expect(logs[0]).toEqual({ event: 'config_invalid', data: { variables: 'ANTHROPIC_API_KEY' } });
  });
});

describe('contrôles d’entrée', () => {
  it('origine, méthode, jeton, corps', async () => {
    const { handle, rpcCalls } = setup();
    expect((await handle(request({}, { origin: 'https://pirate.example' }))).status).toBe(403);
    expect((await handle(request({}, { origin: null }))).status).toBe(403);
    const pre = await handle(request(null, { method: 'OPTIONS' }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect((await handle(request(null, { method: 'GET' }))).status).toBe(405);
    expect((await handle(request({ action: 'start', scenario: 'garage' }, { auth: null }))).status).toBe(401);
    expect((await handle(request(null, { raw: 'x'.repeat(5000) }))).status).toBe(413);
    expect((await handle(request(null, { raw: '{', type: 'application/json' }))).status).toBe(400);
    expect((await handle(request({ action: 'start', scenario: '<x>' }))).status).toBe(400);
    expect((await handle(request({ action: 'say', session_id: SESSION, text: 'x', extra: 1 }))).status).toBe(400);
    expect((await handle(request({ action: 'voler' }))).status).toBe(400);
    expect(rpcCalls).toHaveLength(0);
  });

  it('jeton refusé par Auth : 401', async () => {
    const { handle } = setup({ user: json(401, {}) });
    expect((await handle(request({ action: 'start', scenario: 'garage' }))).status).toBe(401);
  });
});

describe('start', () => {
  it('ouvre la session avec la phrase du commerçant, sans appeler l’IA ; identité tirée du jeton', async () => {
    const { handle, rpcCalls, aiCalls } = setup();
    const res = await read(await handle(request({ action: 'start', scenario: 'garage' })));
    expect(res).toEqual({ status: 200, body: { ok: true, session_id: SESSION, opening: 'Garage du Pont, j’écoute.', max_chars: 600 } });
    expect(rpcCalls).toEqual([{ fn: 'roleplay_start', body: { p_stacker: USER_ID, p_scenario: 'garage', p_opening: 'Garage du Pont, j’écoute.' } }]);
    expect(aiCalls).toHaveLength(0);
  });

  it('scénario inconnu : 404 ; quota du jour : 429 ; plafond global : 503', async () => {
    expect((await setup().handle(request({ action: 'start', scenario: 'inconnu' }))).status).toBe(404);
    expect(await read(await setup({ rpc: { roleplay_start: rpcError(400, 'daily_quota') } }).handle(request({ action: 'start', scenario: 'garage' })))).toEqual({
      status: 429,
      body: { ok: false, error: 'daily_quota' },
    });
    expect((await setup({ rpc: { roleplay_start: rpcError(400, 'unavailable') } }).handle(request({ action: 'start', scenario: 'garage' }))).status).toBe(503);
  });
});

describe('say', () => {
  it('le commerçant répond à partir de l’historique EN BASE, et la paire est enregistrée', async () => {
    const { handle, rpcCalls, aiCalls, models } = setup();
    const res = await read(await handle(request({ action: 'say', session_id: SESSION, text: '  J’ai vu   votre fiche Google. ' })));
    expect(res).toEqual({ status: 200, body: { ok: true, reply: 'Oui, je vous écoute.', hung_up: false, turns_left: 9 } });
    expect(models).toEqual([DEFAULT_MODEL]);
    expect(aiCalls[0]?.system).toContain('Sophie Martin');
    expect(aiCalls[0]?.messages.at(-1)).toEqual({ role: 'user', content: 'J’ai vu votre fiche Google.' });
    expect(aiCalls[0]?.messages[1]).toEqual({ role: 'assistant', content: 'Boulangerie Martin, bonjour !' });
    expect(rpcCalls.map((c) => c.fn)).toEqual(['roleplay_get', 'roleplay_append']);
    expect(rpcCalls[1]?.body).toEqual({
      p_stacker: USER_ID,
      p_session: SESSION,
      p_said: 'J’ai vu votre fiche Google.',
      p_reply: 'Oui, je vous écoute.',
      p_hung_up: false,
      p_tokens_in: 800,
      p_tokens_out: 12,
    });
  });

  it('le commerçant raccroche', async () => {
    const { handle } = setup({ ai: async () => ({ text: 'Non merci. [RACCROCHE]', tokensIn: 1, tokensOut: 1 }) });
    expect((await read(await handle(request({ action: 'say', session_id: SESSION, text: 'Achetez !' })))).body).toMatchObject({ reply: 'Non merci.', hung_up: true });
  });

  it('phrase vide ou trop longue : 400 sans appel à l’IA ; appel trop long : 409', async () => {
    const a = setup();
    expect((await a.handle(request({ action: 'say', session_id: SESSION, text: '   ' }))).status).toBe(400);
    expect((await a.handle(request({ action: 'say', session_id: SESSION, text: 'x'.repeat(601) }))).status).toBe(400);
    expect(a.aiCalls).toHaveLength(0);
    const b = setup({ session: { max_turns: 4 } });
    expect(await read(await b.handle(request({ action: 'say', session_id: SESSION, text: 'Bonjour' })))).toEqual({ status: 409, body: { ok: false, error: 'too_long' } });
  });

  it('session d’un autre ou fermée : 404 / 409', async () => {
    expect((await setup({ rpc: { roleplay_get: rpcError(404, 'not_found') } }).handle(request({ action: 'say', session_id: SESSION, text: 'a' }))).status).toBe(404);
    expect((await setup({ rpc: { roleplay_get: rpcError(400, 'session_closed') } }).handle(request({ action: 'say', session_id: SESSION, text: 'a' }))).status).toBe(409);
    expect((await setup({ session: { scenario: 'disparu' } }).handle(request({ action: 'say', session_id: SESSION, text: 'a' }))).status).toBe(404);
  });

  it('IA indisponible : 502 ai_unavailable, rien n’est enregistré', async () => {
    const { handle, rpcCalls, logs } = setup({
      ai: async () => {
        throw new AiError(529, 'surchargé');
      },
    });
    expect(await read(await handle(request({ action: 'say', session_id: SESSION, text: 'Bonjour' })))).toEqual({ status: 502, body: { ok: false, error: 'ai_unavailable' } });
    expect(rpcCalls.map((c) => c.fn)).toEqual(['roleplay_get']);
    expect(logs.at(-1)).toEqual({ event: 'ai_error', data: { status: 529 } });
  });
});

describe('finish', () => {
  it('bilan : note recalculée ici (jamais celle de l’IA), enregistrée, critères renvoyés', async () => {
    const { handle, rpcCalls, aiCalls } = setup({ ai: async () => ({ text: JSON.stringify({ ...evaluation, total: 100 }), tokensIn: 2000, tokensOut: 400 }) });
    const res = await read(await handle(request({ action: 'finish', session_id: SESSION })));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, score: 75, passed: true, pass_score: 70, min_stacker_turns: 5 });
    expect(res.body['criteria']).toEqual([
      { id: 'presentation', note: 18, commentaire: 'Clair.' },
      { id: 'accroche', note: 16, commentaire: 'Précise.' },
      { id: 'decouverte', note: 12, commentaire: 'Une seule question.' },
      { id: 'offre', note: 15, commentaire: 'Prix annoncé.' },
      { id: 'conclusion', note: 14, commentaire: 'Rendez-vous fixé.' },
    ]);
    expect(aiCalls[0]?.temperature).toBe(0);
    expect(aiCalls[0]?.messages[0]?.content).toContain('<appel>\nCommerçant : Boulangerie Martin, bonjour !\nStacker : Bonjour, Inès Martin pour Stacker.');
    expect(rpcCalls[1]).toMatchObject({ fn: 'roleplay_finish', body: { p_score: 75, p_tokens_in: 2000, p_tokens_out: 400, p_feedback: evaluation } });
  });

  it('faute grave : note plafonnée', async () => {
    const { handle } = setup({ ai: async () => ({ text: JSON.stringify({ ...evaluation, faute_grave: 'Promesse de 30 clients' }), tokensIn: 1, tokensOut: 1 }) });
    expect((await read(await handle(request({ action: 'finish', session_id: SESSION })))).body).toMatchObject({ score: 40, passed: false });
  });

  it('appel sans aucune phrase du stacker : bilan à zéro sans appel à l’IA', async () => {
    const { handle, aiCalls, rpcCalls } = setup({ session: { stacker_turns: 0, turns: [{ role: 'prospect', text: 'Allô ?' }] } });
    expect((await read(await handle(request({ action: 'finish', session_id: SESSION })))).body).toMatchObject({ score: 0, passed: false });
    expect(aiCalls).toHaveLength(0);
    expect(rpcCalls[1]?.body).toMatchObject({ p_score: 0, p_tokens_in: 0 });
  });

  it('bilan illisible : 502, rien n’est enregistré (le stacker peut réessayer)', async () => {
    const { handle, rpcCalls } = setup({ ai: async () => ({ text: 'Désolé, je ne peux pas.', tokensIn: 1, tokensOut: 1 }) });
    expect((await handle(request({ action: 'finish', session_id: SESSION }))).status).toBe(502);
    expect(rpcCalls.map((c) => c.fn)).toEqual(['roleplay_get']);
  });

  it('erreur serveur inattendue : 502 journalisée sans détail', async () => {
    const { handle, logs } = setup({ rpc: { roleplay_get: json(200, { inattendu: true }) } });
    expect(await read(await handle(request({ action: 'finish', session_id: SESSION })))).toEqual({ status: 502, body: { ok: false, error: 'server_error' } });
    expect(logs.at(-1)).toEqual({ event: 'server_error', data: { reason: 'invalid_payload' } });
    const b = setup({ rpc: { roleplay_get: json(500, { message: 'boom' }) } });
    await b.handle(request({ action: 'finish', session_id: SESSION }));
    expect(b.logs.at(-1)).toEqual({ event: 'server_error', data: { reason: 'rpc_500' } });
  });
});
