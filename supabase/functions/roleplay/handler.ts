/**
 * Entraînement à l'appel : trois actions, identité toujours tirée du jeton.
 *
 *   start  : ouvre une session (le commerçant décroche, sans appel à l'IA).
 *   say    : le stacker dit une phrase, le commerçant répond (IA).
 *   finish : l'appel se termine, l'IA rédige le bilan, la note est calculée
 *            ici et enregistrée une seule fois.
 *
 * L'historique est lu en base à chaque tour : le navigateur n'envoie que la
 * dernière phrase et ne peut pas réécrire la conversation.
 */
import { z } from 'zod';
import { callRpc, fetchAuthUser, RpcError, type FetchLike } from '../_shared/rest.ts';
import { bearer, corsHeaders, jsonResponse, readJson } from '../_shared/http.ts';
import {
  AiError,
  CRITERIA,
  evaluatorSystem,
  parseEvaluation,
  parseReply,
  prospectMessages,
  prospectSystem,
  scoreOf,
  transcriptOf,
  type AiClient,
  type Evaluation,
  type Turn,
} from './ai.ts';
import type { ConfigResult, Provider } from './config.ts';
import { scenarioById } from './scenarios.ts';

export interface HandlerDeps {
  config: ConfigResult;
  fetch: FetchLike;
  ai: (provider: Provider, apiKey: string, model: string) => AiClient;
  log: (event: string, data?: Record<string, string | number | boolean>) => void;
}

const bodySchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('start'), scenario: z.string().regex(/^[a-z0-9-]{2,40}$/) }),
  z.strictObject({ action: z.literal('say'), session_id: z.uuid(), text: z.string().max(2000) }),
  z.strictObject({ action: z.literal('finish'), session_id: z.uuid() }),
]);

const sessionSchema = z.object({
  scenario: z.string(),
  turns: z.array(z.object({ role: z.enum(['stacker', 'prospect']), text: z.string() }).loose()),
  max_chars: z.number().int(),
  max_turns: z.number().int(),
  stacker_turns: z.number().int(),
});
const startSchema = z.object({ session_id: z.uuid(), max_chars: z.number().int(), max_turns: z.number().int() });
const appendSchema = z.object({ turns: z.number().int(), max_turns: z.number().int() });
const finishSchema = z.object({ score: z.number().int(), passed: z.boolean(), stacker_turns: z.number().int(), min_stacker_turns: z.number().int(), pass_score: z.number().int() });

/** Erreurs métier renvoyées par la base, et leur statut HTTP. */
const KNOWN: Record<string, number> = {
  onboarding_required: 403,
  consent_required: 403,
  invalid_request: 400,
  daily_quota: 429,
  unavailable: 503,
  not_found: 404,
  session_closed: 409,
  too_long: 409,
};

/** Bilan d'un appel où le stacker n'a rien dit : pas d'appel à l'IA. */
const EMPTY_EVALUATION: Evaluation = {
  criteres: {
    presentation: { note: 0, commentaire: 'Tu n’as rien dit pendant l’appel.' },
    accroche: { note: 0, commentaire: 'Pas d’accroche.' },
    decouverte: { note: 0, commentaire: 'Pas de question.' },
    offre: { note: 0, commentaire: 'Pas d’offre présentée.' },
    conclusion: { note: 0, commentaire: 'Pas de proposition.' },
  },
  points_forts: [],
  a_ameliorer: ['Présente-toi dès que le commerçant décroche : ton nom, ton statut et pourquoi tu appelles son entreprise.'],
  phrase_cle: 'Bonjour, je suis [ton prénom et ton nom], apporteur d’affaires indépendant pour Stacker. Je vous appelle au sujet de votre fiche Google.',
  resume: 'Appel terminé sans échange.',
  faute_grave: null,
  issue: 'raccroche',
};

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  if (!deps.config.ok) deps.log('config_invalid', { variables: deps.config.missing.join(',') });
  return async function handle(req: Request): Promise<Response> {
    if (!deps.config.ok) return jsonResponse(503, { ok: false, error: 'unavailable' });
    const config = deps.config.config;
    const origin = req.headers.get('origin');
    if (!origin || !config.allowedOrigins.has(origin)) return jsonResponse(403, { ok: false, error: 'forbidden_origin' });
    const cors = corsHeaders(origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'method_not_allowed' }, cors);
    const token = bearer(req);
    if (!token) return jsonResponse(401, { ok: false, error: 'unauthorized' }, cors);
    const body = await readJson(req, 4096);
    if (!body.ok) return jsonResponse(body.status, { ok: false, error: 'invalid_request' }, cors);
    const parsed = bodySchema.safeParse(body.value);
    if (!parsed.success) return jsonResponse(400, { ok: false, error: 'invalid_request' }, cors);
    const input = parsed.data;
    const rpc = (fn: string, args: Record<string, unknown>) => callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, fn, args);

    try {
      const user = await fetchAuthUser(deps.fetch, config.supabaseUrl, config.anonKey, token);
      if (!user) return jsonResponse(401, { ok: false, error: 'unauthorized' }, cors);

      if (input.action === 'start') {
        const scenario = scenarioById(input.scenario);
        if (!scenario) return jsonResponse(404, { ok: false, error: 'not_found' }, cors);
        const started = startSchema.parse(await rpc('roleplay_start', { p_stacker: user.id, p_scenario: scenario.id, p_opening: scenario.opening }));
        deps.log('session_started', { scenario: scenario.id });
        return jsonResponse(200, { ok: true, session_id: started.session_id, opening: scenario.opening, max_chars: started.max_chars }, cors);
      }

      const session = sessionSchema.parse(await rpc('roleplay_get', { p_stacker: user.id, p_session: input.session_id }));
      const scenario = scenarioById(session.scenario);
      if (!scenario) return jsonResponse(404, { ok: false, error: 'not_found' }, cors);
      const ai = deps.ai(config.provider, config.apiKey, config.model);
      const turns: Turn[] = session.turns.map((t) => ({ role: t.role, text: t.text }));

      if (input.action === 'say') {
        const said = input.text.replace(/\s+/g, ' ').trim();
        if (!said || said.length > session.max_chars) return jsonResponse(400, { ok: false, error: 'invalid_request' }, cors);
        if (turns.length + 2 > session.max_turns) return jsonResponse(409, { ok: false, error: 'too_long' }, cors);
        const out = await ai.complete({ system: prospectSystem(scenario), messages: prospectMessages(turns, said), maxTokens: 300, temperature: 0.8 });
        const { reply, hungUp } = parseReply(out.text);
        const appended = appendSchema.parse(
          await rpc('roleplay_append', {
            p_stacker: user.id,
            p_session: input.session_id,
            p_said: said,
            p_reply: reply,
            p_hung_up: hungUp,
            p_tokens_in: out.tokensIn,
            p_tokens_out: out.tokensOut,
          }),
        );
        return jsonResponse(200, { ok: true, reply, hung_up: hungUp, turns_left: Math.max(0, Math.floor((appended.max_turns - appended.turns) / 2)) }, cors);
      }

      // finish
      let evaluation = EMPTY_EVALUATION;
      let tokensIn = 0;
      let tokensOut = 0;
      if (session.stacker_turns > 0) {
        const out = await ai.complete({
          system: evaluatorSystem(scenario),
          messages: [{ role: 'user', content: `Voici l'appel à évaluer.\n${transcriptOf(turns)}` }],
          maxTokens: 1500,
          temperature: 0,
        });
        const result = parseEvaluation(out.text);
        if (!result) throw new AiError(502, 'bilan illisible');
        evaluation = result;
        tokensIn = out.tokensIn;
        tokensOut = out.tokensOut;
      }
      const score = scoreOf(evaluation);
      const done = finishSchema.parse(
        await rpc('roleplay_finish', {
          p_stacker: user.id,
          p_session: input.session_id,
          p_score: score,
          p_feedback: evaluation,
          p_tokens_in: tokensIn,
          p_tokens_out: tokensOut,
        }),
      );
      deps.log('session_finished', { scenario: scenario.id, score, passed: done.passed });
      return jsonResponse(
        200,
        {
          ok: true,
          score: done.score,
          passed: done.passed,
          pass_score: done.pass_score,
          stacker_turns: done.stacker_turns,
          min_stacker_turns: done.min_stacker_turns,
          criteria: CRITERIA.map((c) => ({ id: c, note: evaluation.criteres[c].note, commentaire: evaluation.criteres[c].commentaire })),
          feedback: evaluation,
        },
        cors,
      );
    } catch (error) {
      if (error instanceof RpcError && KNOWN[error.message]) {
        return jsonResponse(KNOWN[error.message] ?? 400, { ok: false, error: error.message }, cors);
      }
      if (error instanceof AiError) {
        deps.log('ai_error', { status: error.status });
        return jsonResponse(502, { ok: false, error: 'ai_unavailable' }, cors);
      }
      deps.log('server_error', { reason: error instanceof RpcError ? `rpc_${String(error.status)}` : error instanceof z.ZodError ? 'invalid_payload' : 'exception' });
      return jsonResponse(502, { ok: false, error: 'server_error' }, cors);
    }
  };
}
