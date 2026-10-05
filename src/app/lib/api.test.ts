import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProfileUpdate } from '@shared/account';
import { ApiError, apiErrorMessage, completeOnboarding, deleteAccount, exportMyData, fetchProfile, fetchTiers, profileChecklist, updateProfile, type Profile } from './api';
import { createBackend, getBackend, type Backend } from './supabase';

const URL_BASE = 'https://t.supabase.co';
const PROFILE: Profile = {
  id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Inès',
  last_name: null,
  phone: null,
  department: '84',
  city: null,
  legal_status: null,
  siret: null,
  goal: 'complement',
  tier: 'rookie',
  active_clients: 0,
  xp: 0,
  adult_declared_at: '2026-10-05T10:00:00Z',
  launch_priority: false,
  waitlist_joined_at: null,
  onboarding_completed_at: '2026-10-05T10:05:00Z',
  created_at: '2026-10-05T10:00:00Z',
};

const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function setup(responder: (url: string, init?: RequestInit) => Response | Promise<Response>, token: string | null = 'jeton-utilisateur') {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? init.body : null });
    return responder(url, init);
  });
  const backend = createBackend({ supabaseUrl: URL_BASE, supabaseAnonKey: 'cle-publique', turnstileSiteKey: null })!;
  vi.spyOn(backend, 'accessToken').mockResolvedValue(token);
  // Le client PostgREST lit le jeton via getSession().
  vi.spyOn(backend.auth, 'getSession').mockResolvedValue({ data: { session: token ? ({ access_token: token } as never) : null }, error: null });
  return { backend, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clients Supabase', () => {
  it('sans configuration : aucun client', () => {
    expect(createBackend({ supabaseUrl: null, supabaseAnonKey: null, turnstileSiteKey: null })).toBeNull();
    // Build de test sans variables VITE_ : instance unique nulle.
    expect(getBackend()).toBeNull();
    expect(getBackend()).toBeNull();
  });

  it('PostgREST : clé publique + jeton de l’utilisateur, jamais de clé secrète', async () => {
    const { backend, calls } = setup(() => json(200, PROFILE));
    await fetchProfile(backend);
    expect(calls[0]!.url).toContain(`${URL_BASE}/rest/v1/profiles?select=id%2Cfirst_name`);
    expect(calls[0]!.headers.get('apikey')).toBe('cle-publique');
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer jeton-utilisateur');
  });

  it('sans session : la requête part sans Authorization (la RLS refuse)', async () => {
    const { backend, calls } = setup(() => json(200, PROFILE), null);
    await fetchProfile(backend);
    expect(calls[0]!.headers.get('authorization')).toBeNull();
  });

  it('accessToken lit la session courante', async () => {
    vi.stubGlobal('fetch', () => json(200, {}));
    const backend = createBackend({ supabaseUrl: URL_BASE, supabaseAnonKey: 'cle', turnstileSiteKey: null })!;
    expect(await backend.accessToken()).toBeNull();
  });
});

describe('profil et paliers', () => {
  it('lit et valide le profil', async () => {
    const { backend } = setup(() => json(200, PROFILE));
    expect(await fetchProfile(backend)).toEqual(PROFILE);
  });

  it('profil illisible ou niveau inconnu : erreur serveur', async () => {
    const { backend } = setup(() => json(200, { ...PROFILE, tier: 'boss' }));
    await expect(fetchProfile(backend)).rejects.toMatchObject({ kind: 'server' });
  });

  it('erreurs PostgREST traduites', async () => {
    const cases: [Response, string][] = [
      [json(400, { code: '23514', message: 'check' }), 'invalid'],
      [json(400, { code: '22023', message: 'x' }), 'invalid'],
      [json(403, { code: '42501', message: 'permission denied' }), 'forbidden'],
      [json(401, { code: 'PGRST301', message: 'jwt' }), 'unauthorized'],
      [json(500, { code: 'XX000', message: 'boom' }), 'server'],
    ];
    for (const [res, kind] of cases) {
      const { backend } = setup(() => res.clone());
      await expect(fetchProfile(backend)).rejects.toMatchObject({ kind });
    }
  });

  it('erreur réseau', async () => {
    const { backend } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(fetchProfile(backend)).rejects.toMatchObject({ kind: 'network' });
  });

  it('paliers : lus triés, validés', async () => {
    const tiers = [{ code: 'rookie', label: 'Rookie', rate_bps: 1500, min_active_clients: 0, max_active_clients: 2, sort_order: 1, criteria_provisional: true }];
    const { backend, calls } = setup(() => json(200, tiers));
    expect(await fetchTiers(backend)).toEqual(tiers);
    expect(calls[0]!.url).toContain('order=sort_order.asc');
    const bad = setup(() => json(200, [{ code: 'x' }]));
    await expect(fetchTiers(bad.backend)).rejects.toMatchObject({ kind: 'server' });
    const err = setup(() => json(401, { code: '42501', message: 'denied' }));
    await expect(fetchTiers(err.backend)).rejects.toBeInstanceOf(ApiError);
  });

  it('mise à jour : uniquement les colonnes déclaratives, filtrée sur l’utilisateur', async () => {
    const values: ProfileUpdate = { first_name: 'Inès', last_name: 'Martin', phone: '+33612345678', department: '84', city: 'Avignon', legal_status: null, siret: null, goal: null };
    const { backend, calls } = setup(() => json(200, { ...PROFILE, ...values }));
    const out = await updateProfile(backend, PROFILE.id, values);
    expect(out.last_name).toBe('Martin');
    expect(calls[0]!.method).toBe('PATCH');
    expect(calls[0]!.url).toContain(`id=eq.${PROFILE.id}`);
    expect(JSON.parse(calls[0]!.body!)).toEqual(values);
    await expect(updateProfile(setup(() => json(400, { code: '23514', message: 'siret' })).backend, PROFILE.id, values)).rejects.toMatchObject({ kind: 'invalid' });
    await expect(updateProfile(setup(() => json(200, { nope: 1 })).backend, PROFILE.id, values)).rejects.toMatchObject({ kind: 'server' });
  });

  it('onboarding : RPC serveur', async () => {
    const { backend, calls } = setup(() => new Response(null, { status: 204 }));
    await completeOnboarding(backend, { firstName: 'Inès', department: '84', goal: 'decouvrir' });
    expect(calls[0]!.url).toBe(`${URL_BASE}/rest/v1/rpc/complete_onboarding`);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ p_first_name: 'Inès', p_department: '84', p_goal: 'decouvrir' });
    await expect(completeOnboarding(setup(() => json(400, { code: '22023', message: 'invalid_first_name' })).backend, { firstName: '', department: '84', goal: 'decouvrir' })).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('export RGPD : format vérifié', async () => {
    const { backend } = setup(() => json(200, { format: 'stacker-export-v1', profile: PROFILE }));
    expect(await exportMyData(backend)).toMatchObject({ format: 'stacker-export-v1' });
    await expect(exportMyData(setup(() => json(200, { autre: true })).backend)).rejects.toMatchObject({ kind: 'server' });
    await expect(exportMyData(setup(() => json(401, { code: '42501', message: 'x' })).backend)).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});

describe('suppression du compte', () => {
  it('appelle la fonction serveur avec le jeton, sans identifiant dans le corps', async () => {
    const { backend, calls } = setup(() => json(200, { ok: true, status: 'deleted' }));
    await deleteAccount(backend);
    expect(calls[0]!.url).toBe(`${URL_BASE}/functions/v1/account-delete`);
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer jeton-utilisateur');
    expect(JSON.parse(calls[0]!.body!)).toEqual({ confirm: 'SUPPRIMER' });
  });

  it('sans session : refus local', async () => {
    const { backend, calls } = setup(() => json(200, {}), null);
    await expect(deleteAccount(backend)).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(calls).toHaveLength(0);
  });

  it('codes d’erreur de la fonction', async () => {
    const cases: [() => Response, string][] = [
      [() => json(401, { ok: false, error: 'reauth_required' }), 'reauth_required'],
      [() => json(401, { ok: false, error: 'unauthorized' }), 'unauthorized'],
      [() => json(429, { ok: false, error: 'rate_limited' }), 'rate_limited'],
      [() => new Response('trop', { status: 429 }), 'rate_limited'],
      [() => json(500, { ok: false, error: 'server_error' }), 'server'],
      [() => new Response('<html>', { status: 502 }), 'server'],
    ];
    for (const [res, kind] of cases) {
      await expect(deleteAccount(setup(res).backend)).rejects.toMatchObject({ kind });
    }
  });

  it('erreur réseau', async () => {
    const { backend } = setup(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(deleteAccount(backend)).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('messages et liste « pour bien démarrer »', () => {
  it('un message par type d’erreur, jamais de détail technique', () => {
    const kinds = ['network', 'invalid', 'forbidden', 'unauthorized', 'reauth_required', 'rate_limited', 'server'] as const;
    const messages = kinds.map((k) => apiErrorMessage(new ApiError(k)));
    expect(new Set(messages).size).toBe(kinds.length);
    expect(apiErrorMessage(new Error('boom'))).toBe(apiErrorMessage(new ApiError('server')));
  });

  it('étapes calculées sur le profil réel', () => {
    expect(profileChecklist(PROFILE).map((c) => c.done)).toEqual([false, false, false]);
    const full: Backend extends never ? never : Profile = { ...PROFILE, last_name: 'Martin', phone: '+33612345678', city: 'Avignon', legal_status: 'sans_statut' };
    expect(profileChecklist(full).map((c) => c.done)).toEqual([true, true, true]);
  });
});
