/**
 * Faux Supabase (Auth/GoTrue, PostgREST, Edge Function account-delete) pour
 * les tests e2e, branché par interception réseau Playwright sur
 * https://e2e-stacker.supabase.co.
 *
 * Fidélité recherchée :
 *   - mêmes routes, mêmes formes de réponse et mêmes codes d'erreur que
 *     GoTrue v2 (code + error_code, msg) et PostgREST (code, message) ;
 *   - mêmes RÈGLES SERVEUR que la base (supabase/migrations) : profil créé à
 *     l'inscription seulement avec majorité déclarée et CGU versionnées,
 *     priorité de liste d'attente rattachée à la confirmation, RLS (chacun ne
 *     voit que sa ligne), colonnes modifiables limitées, contrôles SIRET et
 *     téléphone, onboarding horodaté par le serveur, export limité à soi,
 *     suppression exigeant une connexion de moins de 10 minutes ;
 *   - aucune énumération : inscription d'une adresse existante = 200 sans
 *     email, mot de passe oublié = 200 dans tous les cas, OTP sans compte =
 *     erreur otp_disabled (comme GoTrue), que l'app doit rendre neutre.
 * Les emails « envoyés » sont rangés dans `outbox` : un test y lit le lien
 * (token_hash) ou le code, ce qui simule l'ouverture de la boîte mail.
 */
import { createHash } from 'node:crypto';
import type { Route } from '@playwright/test';
import { FakeProspects, type StackerInfo } from './fake-prospects';

export const FAKE_SUPABASE = 'https://e2e-stacker.supabase.co';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-expose-headers': 'x-supabase-api-version, content-range',
};

const UPDATABLE = new Set(['first_name', 'last_name', 'phone', 'department', 'city', 'legal_status', 'siret', 'goal']);
const DEPARTMENT_RE = /^(0[1-9]|1[0-9]|2[1-9]|[3-8][0-9]|9[0-5]|2A|2B|97[1-46])$/;
/** Mots de passe « ayant fuité » (simule la vérification HaveIBeenPwned de Supabase). */
const PWNED = new Set(['Motdepasse123', 'Azerty123456']);

export interface FakeUser {
  id: string;
  email: string;
  password: string;
  confirmedAt: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface FakeProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  department: string | null;
  city: string | null;
  legal_status: string | null;
  siret: string | null;
  goal: string | null;
  tier: string;
  active_clients: number;
  xp: number;
  adult_declared_at: string;
  launch_priority: boolean;
  waitlist_joined_at: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
}

export interface Email {
  to: string;
  type: 'signup' | 'recovery' | 'magiclink';
  tokenHash: string;
  code: string;
  used: boolean;
}

interface Session {
  userId: string;
  accessToken: string;
  refreshToken: string;
  amrAt: number;
  revoked: boolean;
}

export const TIERS = [
  { code: 'rookie', label: 'Rookie', rate_bps: 1500, min_active_clients: 0, max_active_clients: 2, sort_order: 1, criteria_provisional: true },
  { code: 'pro', label: 'Pro', rate_bps: 1800, min_active_clients: 3, max_active_clients: 9, sort_order: 2, criteria_provisional: true },
  { code: 'legend', label: 'Legend', rate_bps: 2200, min_active_clients: 10, max_active_clients: 24, sort_order: 3, criteria_provisional: true },
  { code: 'elite', label: 'Elite', rate_bps: 2500, min_active_clients: 25, max_active_clients: null, sort_order: 4, criteria_provisional: true },
];

function siretValid(s: string): boolean {
  if (!/^\d{14}$/.test(s)) return false;
  const d = Array.from(s, Number);
  if (s.startsWith('356000000')) return d.reduce((a, b) => a + b, 0) % 5 === 0;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let v = d[13 - i] ?? 0;
    if (i % 2 === 1) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
  }
  return sum % 10 === 0;
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export class FakeSupabase {
  users = new Map<string, FakeUser>();
  profiles = new Map<string, FakeProfile>();
  sessions: Session[] = [];
  outbox: Email[] = [];
  /** Adresses inscrites sur la liste d'attente (date d'inscription). */
  waitlist = new Map<string, { firstName: string; department: string | null; createdAt: string }>();
  /** Journal des appels (méthode + chemin), pour vérifier ce que l'app envoie. */
  calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = [];
  /** Panne simulée : prochaine réponse forcée pour « MÉTHODE /chemin » ou « /chemin ». */
  failNext = new Map<string, { status: number; body: unknown }>();
  private seq = 0;
  /** Prospection (lot 3) : réservations, emails, opposition, recherche. */
  prospects = new FakeProspects(() => this.id());

  private id(): string {
    this.seq++;
    return `00000000-0000-4000-8000-${this.seq.toString(16).padStart(12, '0')}`;
  }

  private random(len: number): string {
    this.seq++;
    return createHash('sha256').update(`${String(this.seq)}-${String(Date.now())}`).digest('base64url').slice(0, len);
  }

  private code(): string {
    this.seq++;
    const n = Number.parseInt(createHash('sha256').update(`code-${String(this.seq)}`).digest('hex').slice(0, 8), 16) % 1_000_000;
    return n.toString().padStart(6, '0');
  }

  /** Crée directement un compte confirmé (état de départ d'un test). */
  seedUser(opts: { email: string; password: string; firstName?: string; onboarded?: boolean; activeClients?: number; profile?: Partial<FakeProfile> }): FakeUser {
    const user = this.createUser(opts.email, opts.password, { adult_declared: true, terms_version: '2026-10-05', first_name: opts.firstName ?? null });
    user.confirmedAt = new Date().toISOString();
    this.linkWaitlist(user);
    const p = this.profiles.get(user.id)!;
    if (opts.onboarded) {
      p.onboarding_completed_at = new Date().toISOString();
      p.department ??= '84';
      p.goal = 'complement';
    }
    if (opts.activeClients !== undefined) {
      p.active_clients = opts.activeClients;
      const clients = opts.activeClients;
      p.tier = [...TIERS].reverse().find((t) => t.min_active_clients <= clients)!.code;
    }
    Object.assign(p, opts.profile ?? {});
    return user;
  }

  lastEmail(to: string, type?: Email['type']): Email | undefined {
    return [...this.outbox].reverse().find((e) => e.to === to && (!type || e.type === type));
  }

  private createUser(email: string, password: string, meta: Record<string, unknown>): FakeUser {
    const id = this.id();
    const now = new Date().toISOString();
    const user: FakeUser = { id, email, password, confirmedAt: null, meta, createdAt: now };
    this.users.set(id, user);
    this.profiles.set(id, {
      id,
      first_name: typeof meta['first_name'] === 'string' ? meta['first_name'].trim() || null : null,
      last_name: null,
      phone: null,
      department: null,
      city: null,
      legal_status: null,
      siret: null,
      goal: null,
      tier: 'rookie',
      active_clients: 0,
      xp: 0,
      adult_declared_at: now,
      launch_priority: false,
      waitlist_joined_at: null,
      onboarding_completed_at: null,
      created_at: now,
    });
    return user;
  }

  private linkWaitlist(user: FakeUser): void {
    const w = this.waitlist.get(user.email);
    const p = this.profiles.get(user.id);
    if (!w || !p || p.launch_priority) return;
    p.launch_priority = true;
    p.waitlist_joined_at = w.createdAt;
    p.first_name ??= w.firstName;
    p.department ??= w.department;
  }

  private byEmail(email: string): FakeUser | undefined {
    return [...this.users.values()].find((u) => u.email === email.trim().toLowerCase());
  }

  private send(user: FakeUser, type: Email['type']): void {
    this.outbox.push({ to: user.email, type, tokenHash: this.random(40), code: this.code(), used: false });
  }

  private userJson(u: FakeUser) {
    return {
      id: u.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: u.email,
      email_confirmed_at: u.confirmedAt,
      confirmed_at: u.confirmedAt,
      phone: '',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: u.meta,
      identities: [{ id: u.id, user_id: u.id, provider: 'email', identity_data: { email: u.email, sub: u.id } }],
      created_at: u.createdAt,
      updated_at: u.createdAt,
      is_anonymous: false,
    };
  }

  private session(u: FakeUser, method: string) {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, amr: [{ method, timestamp: now }], session_id: this.random(12) };
    const s: Session = { userId: u.id, accessToken: `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.${this.random(20)}`, refreshToken: this.random(24), amrAt: now, revoked: false };
    this.sessions.push(s);
    return { access_token: s.accessToken, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: s.refreshToken, user: this.userJson(u) };
  }

  private current(headers: Record<string, string>): { user: FakeUser; session: Session } | null {
    const token = /^Bearer (.+)$/.exec(headers['authorization'] ?? '')?.[1];
    const s = this.sessions.find((x) => x.accessToken === token && !x.revoked);
    const user = s ? this.users.get(s.userId) : undefined;
    return s && user ? { user, session: s } : null;
  }

  /** Point d'entrée de l'interception Playwright. Renvoie false si la route n'est pas gérée ici. */
  async handle(route: Route): Promise<boolean> {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return true;
    }
    const path = url.pathname;
    const functions = ['/functions/v1/account-delete', '/functions/v1/prospects-search', '/functions/v1/opposition-register', '/functions/v1/mail-connect'];
    if (!path.startsWith('/auth/v1/') && !path.startsWith('/rest/v1/') && !functions.includes(path)) return false;
    let body: unknown = null;
    try {
      body = req.postData() ? req.postDataJSON() : null;
    } catch {
      body = req.postData();
    }
    const headers = req.headers();
    this.calls.push({ method, path: `${path}${url.search}`, body, headers });
    const key = this.failNext.has(`${method} ${path}`) ? `${method} ${path}` : path;
    const forced = this.failNext.get(key);
    if (forced) {
      this.failNext.delete(key);
      await this.reply(route, forced.status, forced.body);
      return true;
    }
    const [status, payload] = this.dispatch(method, path, url.searchParams, (body ?? {}) as Record<string, unknown>, headers);
    await this.reply(route, status, payload);
    return true;
  }

  private async reply(route: Route, status: number, payload: unknown): Promise<void> {
    if (status === 204) return route.fulfill({ status, headers: CORS });
    return route.fulfill({ status, headers: { ...CORS, 'x-supabase-api-version': '2024-01-01' }, contentType: 'application/json', body: JSON.stringify(payload) });
  }

  private authError(status: number, code: string, msg: string, extra: Record<string, unknown> = {}): [number, unknown] {
    return [status, { code, error_code: code, msg, ...extra }];
  }

  private pgError(status: number, code: string, message: string): [number, unknown] {
    return [status, { code, message, details: null, hint: null }];
  }

  private weak(password: string): string[] {
    const reasons: string[] = [];
    if (password.length < 12) reasons.push('length');
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) reasons.push('characters');
    if (PWNED.has(password)) reasons.push('pwned');
    return reasons;
  }

  private dispatch(method: string, path: string, q: URLSearchParams, b: Record<string, unknown>, headers: Record<string, string>): [number, unknown] {
    const email = typeof b['email'] === 'string' ? b['email'].trim().toLowerCase() : '';
    switch (`${method} ${path}`) {
      // ------------------------------------------------------------ Auth
      case 'POST /auth/v1/signup': {
        const password = text(b['password']);
        const reasons = this.weak(password);
        if (reasons.length) return this.authError(422, 'weak_password', 'Password is too weak', { weak_password: { reasons } });
        const existing = this.byEmail(email);
        if (existing) {
          // GoTrue : adresse déjà confirmée → faux utilisateur, aucun email (pas d'énumération).
          if (existing.confirmedAt) return [200, { ...this.userJson({ ...existing, id: this.id() }), identities: [] }];
          this.send(existing, 'signup');
          return [200, this.userJson(existing)];
        }
        const meta = (b['data'] ?? {}) as Record<string, unknown>;
        // Trigger handle_new_user : majorité déclarée et CGU versionnées obligatoires.
        if (meta['adult_declared'] !== true || typeof meta['terms_version'] !== 'string' || meta['terms_version'] === '') {
          return this.authError(500, 'unexpected_failure', 'Database error saving new user');
        }
        const user = this.createUser(email, password, meta);
        this.send(user, 'signup');
        return [200, this.userJson(user)];
      }
      case 'POST /auth/v1/token': {
        if (q.get('grant_type') === 'refresh_token') {
          const s = this.sessions.find((x) => x.refreshToken === b['refresh_token'] && !x.revoked);
          const u = s ? this.users.get(s.userId) : undefined;
          if (!s || !u) return this.authError(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
          s.revoked = true;
          const next = this.session(u, 'password');
          // La rotation conserve l'horodatage d'authentification d'origine (amr).
          const created = this.sessions.at(-1)!;
          created.amrAt = s.amrAt;
          return [200, next];
        }
        const user = this.byEmail(email);
        if (!user || user.password !== b['password']) return this.authError(400, 'invalid_credentials', 'Invalid login credentials');
        if (!user.confirmedAt) return this.authError(400, 'email_not_confirmed', 'Email not confirmed');
        return [200, this.session(user, 'password')];
      }
      case 'POST /auth/v1/verify': {
        const type = text(b['type']);
        const mail = b['token_hash']
          ? this.outbox.find((e) => e.tokenHash === b['token_hash'] && !e.used)
          : this.outbox.find((e) => e.to === email && e.code === b['token'] && !e.used);
        const user = mail ? this.byEmail(mail.to) : undefined;
        const typeOk = mail && (type === 'email' || type === mail.type || (type === 'signup' && mail.type === 'signup'));
        if (!mail || !user || !typeOk) return this.authError(403, 'otp_expired', 'Token has expired or is invalid');
        mail.used = true;
        if (!user.confirmedAt) {
          user.confirmedAt = new Date().toISOString();
          this.linkWaitlist(user);
        }
        return [200, this.session(user, mail.type === 'recovery' ? 'recovery' : 'otp')];
      }
      case 'POST /auth/v1/otp': {
        const user = this.byEmail(email);
        if (b['create_user'] !== false) return this.authError(400, 'validation_failed', 'create_user doit être false');
        if (!user?.confirmedAt) return this.authError(422, 'otp_disabled', 'Signups not allowed for otp');
        this.send(user, 'magiclink');
        return [200, {}];
      }
      case 'POST /auth/v1/recover': {
        const user = this.byEmail(email);
        if (user) this.send(user, 'recovery');
        return [200, {}];
      }
      case 'POST /auth/v1/resend': {
        const user = this.byEmail(email);
        if (user && !user.confirmedAt && b['type'] === 'signup') this.send(user, 'signup');
        return [200, {}];
      }
      case 'GET /auth/v1/user': {
        const cur = this.current(headers);
        return cur ? [200, this.userJson(cur.user)] : this.authError(401, 'bad_jwt', 'invalid JWT');
      }
      case 'PUT /auth/v1/user': {
        const cur = this.current(headers);
        if (!cur) return this.authError(401, 'bad_jwt', 'invalid JWT');
        const password = text(b['password']);
        const reasons = this.weak(password);
        if (reasons.length) return this.authError(422, 'weak_password', 'Password is too weak', { weak_password: { reasons } });
        if (password === cur.user.password) return this.authError(422, 'same_password', 'New password should be different from the old password.');
        cur.user.password = password;
        return [200, this.userJson(cur.user)];
      }
      case 'POST /auth/v1/logout': {
        const cur = this.current(headers);
        if (cur) cur.session.revoked = true;
        return [204, null];
      }

      // ------------------------------------------------------------ PostgREST
      case 'GET /rest/v1/profiles': {
        const cur = this.current(headers);
        if (!cur) return this.pgError(401, '42501', 'permission denied for table profiles');
        // RLS : seule la ligne de l'appelant est visible.
        const rows = [...this.profiles.values()].filter((p) => p.id === cur.user.id && this.matches(p, q));
        return this.rows(rows, q, headers);
      }
      case 'PATCH /rest/v1/profiles': {
        const cur = this.current(headers);
        if (!cur) return this.pgError(401, '42501', 'permission denied for table profiles');
        const forbidden = Object.keys(b).filter((k) => !UPDATABLE.has(k));
        if (forbidden.length) return this.pgError(403, '42501', 'permission denied for table profiles');
        const err = this.checkProfile(b);
        if (err) return this.pgError(400, '23514', `new row for relation "profiles" violates check constraint "${err}"`);
        const rows = [...this.profiles.values()].filter((p) => p.id === cur.user.id && this.matches(p, q));
        for (const p of rows) Object.assign(p, b);
        return this.rows(rows, q, headers);
      }
      case 'GET /rest/v1/commission_tiers': {
        if (!this.current(headers)) return this.pgError(401, '42501', 'permission denied for table commission_tiers');
        return [200, TIERS];
      }
      case 'POST /rest/v1/rpc/complete_onboarding': {
        const cur = this.current(headers);
        if (!cur) return this.pgError(401, '42501', 'permission denied for function complete_onboarding');
        const first = text(b['p_first_name']).trim();
        if (first.length < 1 || first.length > 50) return this.pgError(400, '22023', 'invalid_first_name');
        const dep = text(b['p_department']) || null;
        const goal = text(b['p_goal']) || null;
        if (dep && !DEPARTMENT_RE.test(dep)) return this.pgError(400, '23514', 'profiles_department_format');
        if (goal && !['complement', 'activite_principale', 'decouvrir'].includes(goal)) return this.pgError(400, '23514', 'profiles_goal_check');
        const p = this.profiles.get(cur.user.id)!;
        Object.assign(p, { first_name: first, department: dep, goal, onboarding_completed_at: p.onboarding_completed_at ?? new Date().toISOString() });
        return [204, null];
      }
      case 'POST /rest/v1/rpc/export_my_data': {
        const cur = this.current(headers);
        if (!cur) return this.pgError(401, '42501', 'permission denied for function export_my_data');
        const p = this.profiles.get(cur.user.id);
        return [
          200,
          {
            format: 'stacker-export-v1',
            exported_at: new Date().toISOString(),
            account: { id: cur.user.id, email: cur.user.email, created_at: cur.user.createdAt, email_confirmed_at: cur.user.confirmedAt },
            profile: p,
            consents: [
              { purpose: 'terms_privacy', granted: true, document_version: '2026-10-05', source: 'signup' },
              { purpose: 'marketing_email', granted: cur.user.meta['marketing_opt_in'] === true, document_version: '2026-10-05', source: 'signup' },
            ],
            waitlist: null,
          },
        ];
      }

      // ------------------------------------------------------------ Edge Function
      case 'POST /functions/v1/account-delete': {
        const cur = this.current(headers);
        if (!cur) return [401, { ok: false, error: 'unauthorized' }];
        if (b['confirm'] !== 'SUPPRIMER' || Object.keys(b).length !== 1) return [400, { ok: false, error: 'invalid_request' }];
        if (Math.floor(Date.now() / 1000) - cur.session.amrAt > 600) return [401, { ok: false, error: 'reauth_required' }];
        this.users.delete(cur.user.id);
        this.profiles.delete(cur.user.id);
        this.waitlist.delete(cur.user.email);
        for (const s of this.sessions) if (s.userId === cur.user.id) s.revoked = true;
        return [200, { ok: true, status: 'deleted' }];
      }
      case 'GET /rest/v1/email_templates': {
        if (!this.current(headers)) return this.pgError(401, '42501', 'permission denied for table email_templates');
        return [200, this.prospects.templates()];
      }
      case 'POST /functions/v1/prospects-search':
        return this.prospects.search(b, this.stacker(headers));
      case 'POST /functions/v1/opposition-register':
        return this.prospects.opposition(b);
      case 'POST /functions/v1/mail-connect':
        return this.prospects.mailConnect(b, this.stacker(headers), headers['origin'] ?? 'http://localhost:4174');
      default: {
        const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(path);
        const handled = method === 'POST' && rpc?.[1] ? this.prospects.rpc(rpc[1], b, this.stacker(headers)) : null;
        if (handled) return handled;
        return this.pgError(404, 'PGRST202', `route inconnue du faux Supabase : ${method} ${path}`);
      }
    }
  }

  private stacker(headers: Record<string, string>): StackerInfo | null {
    const cur = this.current(headers);
    const p = cur ? this.profiles.get(cur.user.id) : undefined;
    return cur && p ? { id: p.id, onboarded: p.onboarding_completed_at !== null, firstName: p.first_name, lastName: p.last_name, phone: p.phone } : null;
  }

  private matches(p: FakeProfile, q: URLSearchParams): boolean {
    const id = q.get('id');
    return !id || id === `eq.${p.id}`;
  }

  private rows(rows: FakeProfile[], q: URLSearchParams, headers: Record<string, string>): [number, unknown] {
    const select = q.get('select');
    const cols = select && select !== '*' ? select.split(',') : null;
    const shaped = rows.map((r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c as keyof FakeProfile]])) : r));
    if ((headers['accept'] ?? '').includes('application/vnd.pgrst.object+json')) {
      if (shaped.length !== 1) return this.pgError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned');
      return [200, shaped[0]];
    }
    return [200, shaped];
  }

  private checkProfile(b: Record<string, unknown>): string | null {
    const str = (k: string) => (typeof b[k] === 'string' ? b[k] : null);
    if ('first_name' in b && (str('first_name') ?? '').length < 1) return 'profiles_first_name_format';
    if (str('phone') && !/^\+[1-9]\d{7,14}$/.test(str('phone')!)) return 'profiles_phone_format';
    if (str('department') && !DEPARTMENT_RE.test(str('department')!)) return 'profiles_department_format';
    if (str('siret') && !siretValid(str('siret')!)) return 'profiles_siret_check';
    if (str('siret') && !['micro_entrepreneur', 'entreprise_individuelle', 'societe'].includes(str('legal_status') ?? '')) return 'profiles_siret_requires_status';
    return null;
  }
}
