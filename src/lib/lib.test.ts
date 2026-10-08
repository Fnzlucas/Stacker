import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWaitlistCount, getWaitlistCountOnce, joinErrorMessage, joinWaitlist, registerOpposition, resetWaitlistCountCache } from './api';
import { isSupabaseConfigured, readPublicEnv, type PublicEnv } from './env';
import { formatInteger, frenchSpaces, plural, positionMessage, waitlistCountLabel } from './format';
import { CONTACT_SUBJECTS, buildMailto, contactSchema } from './mailto';

const ENV: PublicEnv = { supabaseUrl: 'https://proj.supabase.co', supabaseAnonKey: 'sb_publishable_abc', turnstileSiteKey: null };
const JWT_ENV: PublicEnv = { ...ENV, supabaseAnonKey: 'eyJhbGciOi.anon.key' };
const OFF: PublicEnv = { supabaseUrl: null, supabaseAnonKey: null, turnstileSiteKey: null };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => resetWaitlistCountCache());

describe('readPublicEnv', () => {
  it('lit les variables VITE_ et normalise l’URL en origine', () => {
    expect(
      readPublicEnv({ VITE_SUPABASE_URL: ' https://proj.supabase.co/rest/ ', VITE_SUPABASE_ANON_KEY: ' k ', VITE_TURNSTILE_SITE_KEY: '0x4AAA' }),
    ).toEqual({ supabaseUrl: 'https://proj.supabase.co', supabaseAnonKey: 'k', turnstileSiteKey: '0x4AAA' });
  });

  it('variables absentes ou vides : rien de configuré, Turnstile désactivé', () => {
    expect(readPublicEnv({})).toEqual(OFF);
    expect(readPublicEnv({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '   ', VITE_TURNSTILE_SITE_KEY: '' })).toEqual(OFF);
  });

  it('refuse le HTTP non local et les URL invalides, accepte localhost en HTTP', () => {
    expect(readPublicEnv({ VITE_SUPABASE_URL: 'http://proj.supabase.co' }).supabaseUrl).toBeNull();
    expect(readPublicEnv({ VITE_SUPABASE_URL: 'pas une url' }).supabaseUrl).toBeNull();
    expect(readPublicEnv({ VITE_SUPABASE_URL: 42 }).supabaseUrl).toBeNull();
    expect(readPublicEnv({ VITE_SUPABASE_URL: 'ftp://localhost' }).supabaseUrl).toBeNull();
    expect(readPublicEnv({ VITE_SUPABASE_URL: 'http://localhost:54321' }).supabaseUrl).toBe('http://localhost:54321');
    expect(readPublicEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }).supabaseUrl).toBe('http://127.0.0.1:54321');
  });

  it('isSupabaseConfigured exige l’URL ET la clé', () => {
    expect(isSupabaseConfigured(ENV)).toBe(true);
    expect(isSupabaseConfigured({ ...ENV, supabaseAnonKey: null })).toBe(false);
    expect(isSupabaseConfigured({ ...ENV, supabaseUrl: null })).toBe(false);
  });
});

describe('fetchWaitlistCount', () => {
  it('appelle la RPC publique waitlist_count et renvoie l’entier', async () => {
    const fetchFn = vi.fn(async () => json(200, 37));
    expect(await fetchWaitlistCount(ENV, fetchFn)).toBe(37);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/rest/v1/rpc/waitlist_count');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('apikey')).toBe('sb_publishable_abc');
    expect(headers.get('authorization')).toBeNull();
  });

  it('ajoute Authorization pour une clé anon historique (JWT)', async () => {
    const fetchFn = vi.fn(async () => json(200, 0));
    expect(await fetchWaitlistCount(JWT_ENV, fetchFn)).toBe(0);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer eyJhbGciOi.anon.key');
  });

  it('jamais de chiffre inventé : null si non configuré, en erreur, invalide ou hors ligne', async () => {
    const never = vi.fn();
    expect(await fetchWaitlistCount(OFF, never)).toBeNull();
    expect(never).not.toHaveBeenCalled();
    expect(await fetchWaitlistCount(ENV, async () => json(500, {}))).toBeNull();
    expect(await fetchWaitlistCount(ENV, async () => json(200, -1))).toBeNull();
    expect(await fetchWaitlistCount(ENV, async () => json(200, '12'))).toBeNull();
    expect(await fetchWaitlistCount(ENV, async () => json(200, 1.5))).toBeNull();
    expect(
      await fetchWaitlistCount(ENV, async () => {
        throw new TypeError('offline');
      }),
    ).toBeNull();
  });

  it('getWaitlistCountOnce : une seule requête par page', async () => {
    const fetchFn = vi.fn(async () => json(200, 5));
    const [a, b] = await Promise.all([getWaitlistCountOnce(ENV, fetchFn), getWaitlistCountOnce(ENV, fetchFn)]);
    expect([a, b]).toEqual([5, 5]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('joinWaitlist', () => {
  const body = { firstName: 'Inès', email: 'ines@exemple.fr' };
  const success = { ok: true, status: 'joined', position: 3, referralCode: 'ABCDEFGH', referralUrl: 'https://stacker.example/liste-attente?ref=ABCDEFGH' };

  it('non configuré : erreur explicite, aucun appel réseau', async () => {
    const fetchFn = vi.fn();
    expect(await joinWaitlist(OFF, body, fetchFn)).toEqual({ ok: false, error: 'not_configured' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('succès : renvoie la réponse validée', async () => {
    const fetchFn = vi.fn(async () => json(200, success));
    expect(await joinWaitlist(ENV, body, fetchFn)).toEqual({ ok: true, data: success });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/functions/v1/waitlist-join');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it('réponse 200 mal formée ou illisible : server_error', async () => {
    expect(await joinWaitlist(ENV, body, async () => json(200, { ok: true }))).toEqual({ ok: false, error: 'server_error' });
    expect(await joinWaitlist(ENV, body, async () => new Response('<html>', { status: 200 }))).toEqual({ ok: false, error: 'server_error' });
  });

  it('erreurs connues, erreurs de champs, 429 brut, erreur inconnue', async () => {
    expect(await joinWaitlist(ENV, body, async () => json(403, { ok: false, error: 'captcha_failed' }))).toEqual({ ok: false, error: 'captcha_failed' });
    expect(
      await joinWaitlist(ENV, body, async () => json(400, { ok: false, error: 'invalid_request', fields: { email: 'Indique une adresse email valide.' } })),
    ).toEqual({ ok: false, error: 'invalid_request', fields: { email: 'Indique une adresse email valide.' } });
    expect(await joinWaitlist(ENV, body, async () => json(400, { ok: false, error: 'invalid_request' }))).toEqual({ ok: false, error: 'invalid_request' });
    expect(await joinWaitlist(ENV, body, async () => new Response('Too Many', { status: 429 }))).toEqual({ ok: false, error: 'rate_limited' });
    expect(await joinWaitlist(ENV, body, async () => json(418, { ok: false, error: 'teapot' }))).toEqual({ ok: false, error: 'server_error' });
  });

  it('réseau coupé : network', async () => {
    const res = await joinWaitlist(ENV, body, async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(res).toEqual({ ok: false, error: 'network' });
  });

  it('chaque erreur a un message lisible, sans détail technique', () => {
    const codes = [
      'invalid_request',
      'captcha_failed',
      'rate_limited',
      'network',
      'not_configured',
      'unavailable',
      'server_error',
      'forbidden_origin',
      'method_not_allowed',
      'payload_too_large',
      'unsupported_media_type',
    ] as const;
    for (const code of codes) {
      const message = joinErrorMessage(code);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/http|rpc|null|undefined|error/i);
    }
    expect(joinErrorMessage('not_configured')).toBe(joinErrorMessage('unavailable'));
  });
});

describe('format', () => {
  it('formatInteger : typographie française', () => {
    expect(formatInteger(1234)).toBe('1 234');
    expect(formatInteger(0)).toBe('0');
  });

  it('frenchSpaces : espace fine insécable avant la ponctuation haute', () => {
    expect(frenchSpaces('Combien ? Oui : 15 % ; non !')).toBe('Combien\u202f? Oui\u202f: 15\u202f%\u202f; non\u202f!');
    expect(frenchSpaces('rien')).toBe('rien');
  });

  it('plural', () => {
    expect(plural(0, 'a', 'b')).toBe('a');
    expect(plural(1, 'a', 'b')).toBe('a');
    expect(plural(2, 'a', 'b')).toBe('b');
  });

  it('waitlistCountLabel : le vrai nombre, jamais arrondi', () => {
    expect(waitlistCountLabel(0)).toEqual({ strong: null, rest: 'Liste d’attente ouverte' });
    expect(waitlistCountLabel(1)).toEqual({ strong: '1', rest: ' personne inscrite sur la liste d’attente' });
    expect(waitlistCountLabel(1234)).toEqual({ strong: '1 234', rest: ' personnes inscrites sur la liste d’attente' });
  });

  it('positionMessage : distingue les 100 premiers, sans promesse', () => {
    expect(positionMessage(1, 100)).toContain('Tu fais partie des 100 premiers inscrits');
    expect(positionMessage(100, 100)).toContain('Tu fais partie des 100 premiers inscrits');
    expect(positionMessage(101, 100)).not.toContain('Tu fais partie');
    expect(positionMessage(101, 100)).toContain('priorité sur les 100 places');
  });
});

describe('contact (mailto)', () => {
  const valid = { name: ' Inès ', email: ' INES@Exemple.fr ', subject: 'privacy', message: 'Bonjour, je voudrais supprimer mes données.' };

  it('valide et normalise', () => {
    const parsed = contactSchema.parse(valid);
    expect(parsed).toEqual({ name: 'Inès', email: 'ines@exemple.fr', subject: 'privacy', message: valid.message });
  });

  it('refuse champs vides, email invalide, sujet inconnu, champs en trop', () => {
    expect(contactSchema.safeParse({ ...valid, name: ' ' }).success).toBe(false);
    expect(contactSchema.safeParse({ ...valid, email: 'pas-un-email' }).success).toBe(false);
    expect(contactSchema.safeParse({ ...valid, subject: 'spam' }).success).toBe(false);
    expect(contactSchema.safeParse({ ...valid, message: 'court' }).success).toBe(false);
    expect(contactSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });

  it('construit un lien mailto encodé', () => {
    const href = buildMailto('contact@stacker.example', contactSchema.parse(valid));
    expect(href.startsWith('mailto:contact@stacker.example?subject=')).toBe(true);
    const url = new URL(href);
    expect(url.searchParams.get('subject')).toBe('[Stacker] Mes données personnelles (RGPD)');
    expect(url.searchParams.get('body')).toBe(`${valid.message}\n\n— Inès (ines@exemple.fr)`);
    expect(CONTACT_SUBJECTS.length).toBe(5);
  });
});

describe('registerOpposition', () => {
  const env: PublicEnv = readPublicEnv({ VITE_SUPABASE_URL: 'https://proj.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_cle' });
  const off: PublicEnv = readPublicEnv({});
  const reply = (status: number) => async () => new Response('{}', { status });
  it('statuts ⇒ résultat, jamais de détail', async () => {
    expect(await registerOpposition(off, { token: 'a' })).toEqual({ ok: false, error: 'not_configured' });
    let sent: { url: string; body: unknown } | null = null;
    expect(
      await registerOpposition(env, { token: 'abc' }, async (url, init) => {
        sent = { url, body: JSON.parse(init?.body as string) };
        return new Response('{"ok":true}', { status: 200 });
      }),
    ).toEqual({ ok: true });
    expect(sent).toEqual({ url: 'https://proj.supabase.co/functions/v1/opposition-register', body: { token: 'abc' } });
    expect(await registerOpposition(env, { token: 'a' }, reply(400))).toEqual({ ok: false, error: 'invalid' });
    expect(await registerOpposition(env, { token: 'a' }, reply(403))).toEqual({ ok: false, error: 'captcha' });
    expect(await registerOpposition(env, { token: 'a' }, reply(429))).toEqual({ ok: false, error: 'rate_limited' });
    expect(await registerOpposition(env, { token: 'a' }, reply(500))).toEqual({ ok: false, error: 'server' });
    expect(
      await registerOpposition(env, { token: 'a' }, async () => {
        throw new Error('réseau');
      }),
    ).toEqual({ ok: false, error: 'network' });
  });
});
