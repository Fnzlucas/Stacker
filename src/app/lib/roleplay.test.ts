import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../../../supabase/functions/roleplay/scenarios';
import { ApiError } from './apiError';
import {
  fetchRoleplay,
  fetchRoleplayDetail,
  finishRoleplay,
  needsTraining,
  ROLEPLAY_SCENARIOS,
  roleplayErrorMessage,
  RoleplayError,
  sayRoleplay,
  scenarioById,
  startRoleplay,
  type RoleplayState,
} from './roleplay';
import type { Backend } from './supabase';

const SESSION = '22222222-2222-4222-8222-222222222222';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const backend = (rpcResult: { data: unknown; error: { code?: string; message: string } | null; status: number } = { data: null, error: null, status: 200 }, token: string | null = 'jeton') => {
  const calls: unknown[] = [];
  const b = {
    url: 'https://proj.supabase.co',
    anonKey: 'anon',
    accessToken: async () => token,
    db: {
      rpc: async (fn: string, args: unknown) => {
        calls.push([fn, args]);
        return rpcResult;
      },
    },
  } as unknown as Backend;
  return { b, calls };
};

const state: RoleplayState = {
  required: true,
  passed: false,
  pass_score: 70,
  min_stacker_turns: 5,
  today: { used: 1, limit: 8 },
  history: [{ id: SESSION, scenario: 'garage', status: 'terminee', score: 64, passed: false, started_at: '2026-10-30T10:00:00Z' }],
};

const feedback = {
  criteres: {
    presentation: { note: 18, commentaire: 'a' },
    accroche: { note: 16, commentaire: 'b' },
    decouverte: { note: 12, commentaire: 'c' },
    offre: { note: 15, commentaire: 'd' },
    conclusion: { note: 14, commentaire: 'e' },
  },
  points_forts: ['x'],
  a_ameliorer: ['y'],
  phrase_cle: 'z',
  resume: 'r',
  faute_grave: null,
  issue: 'rendez_vous',
};

describe('commerçants proposés', () => {
  it('mêmes identifiants et même difficulté que côté serveur ; fiche publique renseignée', () => {
    expect(ROLEPLAY_SCENARIOS.map((s) => [s.id, s.difficulty])).toEqual(SCENARIOS.map((s) => [s.id, s.difficulty]));
    for (const s of ROLEPLAY_SCENARIOS) {
      expect(s.noticed.length).toBeGreaterThanOrEqual(2);
      expect(s.business && s.contact && s.offers).toBeTruthy();
    }
    expect(scenarioById('hotel')?.voice).toBe('f');
    expect(scenarioById('x')).toBeUndefined();
  });
});

describe('lecture', () => {
  it('my_roleplay et roleplay_detail', async () => {
    const a = backend({ data: state, error: null, status: 200 });
    await expect(fetchRoleplay(a.b)).resolves.toEqual(state);
    const detail = { id: SESSION, scenario: 'garage', status: 'terminee', score: 75, passed: true, feedback, started_at: 'x', ended_at: 'y', turns: [{ role: 'prospect', text: 'Allô' }] };
    const b = backend({ data: detail, error: null, status: 200 });
    await expect(fetchRoleplayDetail(b.b, SESSION)).resolves.toEqual(detail);
    expect(b.calls).toEqual([['roleplay_detail', { p_session: SESSION }]]);
  });

  it('erreurs : réseau, session expirée, introuvable, serveur, réponse illisible', async () => {
    await expect(fetchRoleplay(backend({ data: null, error: { message: 'Failed to fetch' }, status: 0 }).b)).rejects.toMatchObject({ kind: 'network' });
    await expect(fetchRoleplay(backend({ data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 }).b)).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(fetchRoleplayDetail(backend({ data: null, error: { code: 'P0002', message: 'not_found' }, status: 404 }).b, SESSION)).rejects.toBeInstanceOf(RoleplayError);
    await expect(fetchRoleplay(backend({ data: null, error: { code: 'XX', message: 'boom' }, status: 500 }).b)).rejects.toMatchObject({ kind: 'server' });
    await expect(fetchRoleplay(backend({ data: { x: 1 }, error: null, status: 200 }).b)).rejects.toMatchObject({ kind: 'server' });
  });

  it('signature bloquée seulement si exigé ET pas réussi', () => {
    expect(needsTraining(state)).toBe(true);
    expect(needsTraining({ ...state, passed: true })).toBe(false);
    expect(needsTraining({ ...state, required: false })).toBe(false);
    expect(needsTraining(undefined)).toBe(false);
  });
});

describe('appels à la fonction roleplay', () => {
  it('start, say, finish : jeton, corps, réponse validée', async () => {
    const sent: { url: string; init?: RequestInit }[] = [];
    const responses = [
      json(200, { ok: true, session_id: SESSION, opening: 'Allô ?', max_chars: 600 }),
      json(200, { ok: true, reply: 'Oui ?', hung_up: false, turns_left: 10 }),
      json(200, { ok: true, score: 75, passed: true, pass_score: 70, stacker_turns: 6, min_stacker_turns: 5, criteria: [], feedback }),
    ];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      sent.push({ url, init });
      return responses.shift() ?? json(500, {});
    }) as typeof fetch;
    const { b } = backend();
    await expect(startRoleplay(b, 'garage', fetchFn)).resolves.toMatchObject({ session_id: SESSION, opening: 'Allô ?' });
    await expect(sayRoleplay(b, SESSION, 'Bonjour', fetchFn)).resolves.toEqual({ ok: true, reply: 'Oui ?', hung_up: false, turns_left: 10 });
    await expect(finishRoleplay(b, SESSION, fetchFn)).resolves.toMatchObject({ score: 75, passed: true });
    expect(sent.map((s) => JSON.parse(s.init?.body as string) as unknown)).toEqual([
      { action: 'start', scenario: 'garage' },
      { action: 'say', session_id: SESSION, text: 'Bonjour' },
      { action: 'finish', session_id: SESSION },
    ]);
    expect(sent[0]?.url).toBe('https://proj.supabase.co/functions/v1/roleplay');
    expect(new Headers(sent[0]?.init?.headers).get('authorization')).toBe('Bearer jeton');
  });

  it('erreurs : sans jeton, réseau, erreur métier, jeton refusé, réponse illisible', async () => {
    const ok = (async () => json(200, {})) as unknown as typeof fetch;
    await expect(startRoleplay(backend(undefined, null).b, 'garage', ok)).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(startRoleplay(backend().b, 'garage', (() => Promise.reject(new Error('x'))))).rejects.toMatchObject({ kind: 'network' });
    await expect(startRoleplay(backend().b, 'garage', (async () => json(429, { ok: false, error: 'daily_quota' })))).rejects.toMatchObject({ code: 'daily_quota' });
    await expect(startRoleplay(backend().b, 'garage', (async () => json(401, { ok: false, error: 'unauthorized' })))).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(startRoleplay(backend().b, 'garage', (async () => new Response('<html>', { status: 502 })))).rejects.toMatchObject({ kind: 'server' });
  });

  it('messages d’erreur lisibles', () => {
    expect(roleplayErrorMessage(new RoleplayError('daily_quota'))).toContain('Reviens demain');
    expect(roleplayErrorMessage(new RoleplayError('ai_unavailable'))).toContain('n’a pas pu répondre');
    expect(roleplayErrorMessage(new RoleplayError('inconnu'))).toBe('Une erreur est survenue. Réessaie.');
    expect(roleplayErrorMessage(new ApiError('network'))).toContain('Pas de connexion');
    expect(roleplayErrorMessage(new Error('x'))).toBe('Une erreur est survenue. Réessaie.');
  });
});
