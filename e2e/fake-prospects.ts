/**
 * Prospection dans le faux Supabase des tests e2e : mêmes RÈGLES que la base
 * (supabase/migrations/20261008090000_prospects.sql) pour ce que l'app
 * affiche et envoie — réservation exclusive, transitions, échéances,
 * quotas, opposition, email préparé avec pied légal — et même contrat HTTP
 * que l'Edge Function prospects-search (réponse validée par l'app).
 *
 * Les entreprises proposées sont des données DE TEST (jeu fixe ci-dessous),
 * jamais affichées hors des tests.
 */
import { randomBytes } from 'node:crypto';

export interface FakeCompany {
  siret: string;
  siren: string;
  name: string;
  naf: string | null;
  naf_label: string | null;
  employee_band: string | null;
  is_sole_trader: boolean;
  created_on: string | null;
  is_head_office: boolean;
  address: string | null;
  postcode: string | null;
  city: string | null;
  department: string;
  officers: { nom?: string; prenoms?: string; qualite?: string }[];
}

export interface FakeClaim {
  id: string;
  stacker: string;
  siret: string;
  status: string;
  claimed_at: string;
  expires_at: string | null;
  extended: boolean;
  next_action_at: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_email_kind: 'generique' | 'nominatif' | null;
  contact_source: string | null;
  released_at: string | null;
  release_reason: string | null;
}

interface FakeEmail {
  id: string;
  claim_id: string;
  stacker: string;
  template_key: string;
  recipient: string;
  subject: string;
  body: string;
  footer: string;
  token: string;
  marked_sent_at: string | null;
  created_at: string;
}

const DAY = 86_400_000;
const SETTINGS = { maxActive: 40, claimsPerDay: 15, ttl: 10, ttlContacted: 21, ttlRdv: 30, extend: 7, searchesPerDay: 30, emailsPerDay: 40 };

export const TEMPLATES = [
  { key: 'decouverte', label: 'Premier contact', subject: '{{entreprise}} : votre visibilité à {{commune}}', body: 'Bonjour,\n\nJe m’appelle {{prenom}} et j’accompagne les entreprises de {{commune}} avec Stacker.' },
  { key: 'relance', label: 'Relance', subject: '{{entreprise}} : je reviens vers vous', body: 'Bonjour,\n\nJe me permets de revenir vers vous au sujet de {{entreprise}}.' },
  { key: 'suite_appel', label: 'Après un appel', subject: '{{entreprise}} : suite à notre échange', body: 'Bonjour,\n\nMerci pour le temps que vous m’avez accordé au téléphone.' },
];

/** Jeu de test : 30 entreprises dans le Gard (30), dont 12 artisans du bâtiment. */
export function testCompanies(): FakeCompany[] {
  const out: FakeCompany[] = [];
  const names = ['PLOMBERIE DURAND', 'ELEC SUD', 'COIFFURE LEA', 'GARAGE DU PONT', 'BOULANGERIE MARTIN', 'MENUISERIE BLANC'];
  for (let i = 1; i <= 30; i++) {
    const siren = `3${String(i).padStart(8, '0')}`;
    const batiment = i <= 12;
    out.push({
      siret: `${siren}00017`,
      siren,
      name: `${names[(i - 1) % names.length] ?? 'ENTREPRISE'} ${String(i)}`,
      naf: batiment ? '43.22A' : '96.02A',
      naf_label: batiment ? 'Plomberie, eau et gaz' : 'Coiffure',
      employee_band: i % 3 === 0 ? '11' : '00',
      is_sole_trader: i % 2 === 0,
      created_on: i % 4 === 0 ? '2025-03-01' : '2012-06-15',
      is_head_office: true,
      address: `${String(i)} RUE DE LA REPUBLIQUE 30400 VILLENEUVE-LES-AVIGNON`,
      postcode: '30400',
      city: 'VILLENEUVE-LES-AVIGNON',
      department: '30',
      officers: [{ nom: 'DURAND', prenoms: 'Paul', qualite: 'Gérant' }],
    });
  }
  return out;
}

type Reply = [number, unknown];
const pg = (status: number, code: string, message: string): Reply => [status, { code, message, details: null, hint: null }];
const raise = (message: string): Reply => pg(400, 'P0001', message);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

const RANK: Record<string, number> = { a_contacter: 0, contacte: 1, a_repondu: 2, rdv: 3, signe: 4 };

function transitionAllowed(from: string, to: string): boolean {
  if (to === 'pas_interesse') return ['a_contacter', 'contacte', 'a_repondu', 'rdv'].includes(from);
  if (from === 'a_contacter') return ['contacte', 'a_repondu', 'rdv'].includes(to);
  if (from === 'contacte') return ['contacte', 'a_repondu', 'rdv'].includes(to);
  if (from === 'a_repondu') return to === 'rdv';
  if (from === 'rdv') return to === 'a_repondu';
  return false;
}

function emailKind(email: string, officers: FakeCompany['officers']): 'generique' | 'nominatif' {
  const local = email.split('@')[0] ?? '';
  if (/^(contact|info|accueil|bonjour|hello|devis|commercial)([._-]?[a-z0-9]*)?$/.test(local)) return 'generique';
  if (/^[a-z]+[._-][a-z]+$/.test(local) || /^[a-z][._-][a-z]{2,}$/.test(local)) return 'nominatif';
  for (const o of officers) for (const part of `${o.nom ?? ''} ${o.prenoms ?? ''}`.toLowerCase().split(/[^a-z]+/)) if (part.length >= 3 && local.includes(part)) return 'nominatif';
  return 'generique';
}

export interface StackerInfo {
  id: string;
  onboarded: boolean;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

export class FakeProspects {
  companies = new Map<string, FakeCompany>(testCompanies().map((c) => [c.siret, c]));
  claims: FakeClaim[] = [];
  notes: { id: string; claim_id: string; stacker: string; body: string; created_at: string }[] = [];
  events: { claim_id: string; stacker: string; kind: string; payload: Record<string, unknown>; created_at: string }[] = [];
  emails: FakeEmail[] = [];
  opposedSirens = new Set<string>();
  opposedEmails = new Set<string>();
  cooldowns = new Map<string, number>();
  rules = new Map<string, string>();
  usage = new Map<string, number>();
  enabled = true;
  /** Boîtes connectées (stacker → boîte). */
  mailboxes = new Map<string, { provider: 'gmail' | 'outlook'; email: string; status: 'active' | 'error' }>();
  /** Campagnes ouvertes (une par stacker). */
  campaigns = new Map<string, { id: string; department: string; preset: string; daily_target: number; template_key: string; status: 'active' | 'paused'; created_at: string; sent_today: number; sent_total: number }>();
  /** Entreprises « prêtes » (adresse générique connue) que la campagne peut écrire. */
  campaignAvailable = 340;
  /** Appels reçus par la fonction prospects-search (corps). */
  searchCalls: unknown[] = [];
  /** Réponse forcée de la fonction prospects-search (une fois). */
  searchFailNext: { status: number; error: string } | null = null;
  private seq = 0;

  constructor(private readonly newId: () => string) {}

  private use(user: string, metric: string, limit: number): boolean {
    const key = `${user}:${metric}:${new Date().toISOString().slice(0, 10)}`;
    const n = (this.usage.get(key) ?? 0) + 1;
    if (n > limit) return false;
    this.usage.set(key, n);
    return true;
  }

  private used(user: string, metric: string): number {
    return this.usage.get(`${user}:${metric}:${new Date().toISOString().slice(0, 10)}`) ?? 0;
  }

  private log(c: FakeClaim, kind: string, payload: Record<string, unknown> = {}): void {
    this.seq++;
    this.events.push({ claim_id: c.id, stacker: c.stacker, kind, payload, created_at: new Date(Date.now() + this.seq).toISOString() });
  }

  private active(siret: string): FakeClaim | undefined {
    this.expire();
    return this.claims.find((c) => c.siret === siret && c.released_at === null);
  }

  private expire(): void {
    const now = Date.now();
    for (const c of this.claims) {
      if (c.released_at === null && c.status !== 'signe' && c.expires_at && new Date(c.expires_at).getTime() <= now) this.release(c, 'expire');
    }
  }

  private release(c: FakeClaim, reason: string): void {
    c.released_at = new Date().toISOString();
    c.release_reason = reason;
    this.log(c, reason === 'expire' ? 'expire' : reason === 'opposition' ? 'opposition' : 'libere', { reason });
  }

  private own(user: string, id: unknown): FakeClaim | null {
    this.expire();
    return this.claims.find((c) => c.id === id && c.stacker === user && c.released_at === null) ?? null;
  }

  private bump(c: FakeClaim, days: number): void {
    const target = Date.now() + days * DAY;
    if (!c.expires_at || new Date(c.expires_at).getTime() < target) c.expires_at = new Date(target).toISOString();
  }

  private applyStatus(c: FakeClaim, to: string, next: string | null): void {
    const from = c.status;
    if (to === 'pas_interesse') {
      c.status = to;
      this.log(c, 'statut', { from, to });
      this.release(c, 'pas_interesse');
      this.cooldowns.set(c.siret.slice(0, 9), Date.now() + 180 * DAY);
      return;
    }
    c.status = to;
    c.next_action_at = next;
    this.bump(c, to === 'rdv' ? SETTINGS.ttlRdv : (RANK[to] ?? 0) >= 1 ? SETTINGS.ttlContacted : SETTINGS.ttl);
    if (from !== to) this.log(c, 'statut', { from, to });
  }

  private guard(s: StackerInfo | null): Reply | null {
    if (!s) return pg(401, '42501', 'permission denied');
    if (!this.enabled) return raise('disabled');
    if (!s.onboarded) return raise('onboarding_required');
    return null;
  }

  /** RPC PostgREST de la prospection. Renvoie null si la route n'est pas gérée ici. */
  rpc(fn: string, b: Record<string, unknown>, s: StackerInfo | null): Reply | null {
    switch (fn) {
      case 'my_prospect_quotas': {
        if (!s) return pg(401, '42501', 'permission denied');
        this.expire();
        return [
          200,
          {
            enabled: this.enabled,
            rules_version: this.rules.get(s.id) ?? null,
            searches: { used: this.used(s.id, 'search'), limit: SETTINGS.searchesPerDay },
            claims_today: { used: this.used(s.id, 'claim'), limit: SETTINGS.claimsPerDay },
            emails_today: { used: this.used(s.id, 'email'), limit: SETTINGS.emailsPerDay },
            active: { used: this.claims.filter((c) => c.stacker === s.id && c.released_at === null && c.status !== 'signe').length, limit: SETTINGS.maxActive },
          },
        ];
      }
      case 'accept_prospecting_rules': {
        if (!s) return pg(401, '42501', 'permission denied');
        if (!str(b['p_version'])) return pg(400, '22023', 'invalid_version');
        this.rules.set(s.id, String(b['p_version']));
        return [204, null];
      }
      case 'my_prospects': {
        const g = this.guard(s);
        if (g) return g;
        this.expire();
        const rows = this.claims
          .filter((c) => c.stacker === s!.id && c.released_at === null)
          .map((c) => {
            const co = this.companies.get(c.siret)!;
            return {
              id: c.id,
              siret: c.siret,
              status: c.status,
              claimed_at: c.claimed_at,
              expires_at: c.expires_at,
              next_action_at: c.next_action_at,
              has_phone: c.contact_phone !== null,
              has_email: c.contact_email !== null,
              name: co.name,
              naf_label: co.naf_label,
              city: co.city,
              postcode: co.postcode,
            };
          });
        return [200, rows];
      }
      case 'prospect_detail': {
        const g = this.guard(s);
        if (g) return g;
        const c = this.own(s!.id, b['p_claim']);
        if (!c) return pg(404, 'P0002', 'not_found');
        const co = this.companies.get(c.siret)!;
        return [
          200,
          {
            claim: {
              id: c.id,
              status: c.status,
              claimed_at: c.claimed_at,
              expires_at: c.expires_at,
              extended: c.extended,
              next_action_at: c.next_action_at,
              contact_phone: c.contact_phone,
              contact_email: c.contact_email,
              contact_email_kind: c.contact_email_kind,
              contact_source: c.contact_source,
            },
            company: {
              siret: co.siret,
              siren: co.siren,
              name: co.name,
              naf: co.naf,
              naf_label: co.naf_label,
              employee_band: co.employee_band,
              is_sole_trader: co.is_sole_trader,
              created_on: co.created_on,
              address: co.address,
              postcode: co.postcode,
              city: co.city,
              officers: co.officers,
            },
            notes: this.notes.filter((n) => n.claim_id === c.id).reverse().map((n) => ({ id: n.id, body: n.body, created_at: n.created_at })),
            events: this.events.filter((e) => e.claim_id === c.id).reverse().map((e) => ({ kind: e.kind, payload: e.payload, created_at: e.created_at })),
            emails: this.emails.filter((m) => m.claim_id === c.id).reverse().map((m) => ({ id: m.id, template_key: m.template_key, subject: m.subject, marked_sent_at: m.marked_sent_at, created_at: m.created_at })),
          },
        ];
      }
      case 'prospect_claim': {
        const g = this.guard(s);
        if (g) return g;
        const siret = str(b['p_siret']);
        if (!siret || !/^\d{14}$/.test(siret)) return pg(400, '22023', 'invalid_siret');
        if (!this.companies.has(siret)) return pg(404, 'P0002', 'unknown_company');
        if (this.opposedSirens.has(siret.slice(0, 9))) return raise('opposed');
        if ((this.cooldowns.get(siret.slice(0, 9)) ?? 0) > Date.now()) return raise('cooldown');
        if (this.active(siret)) return raise('already_claimed');
        if (this.claims.filter((c) => c.stacker === s!.id && c.released_at === null && c.status !== 'signe').length >= SETTINGS.maxActive) return raise('max_active');
        if (!this.use(s!.id, 'claim', SETTINGS.claimsPerDay)) return raise('daily_quota');
        const c: FakeClaim = {
          id: this.newId(),
          stacker: s!.id,
          siret,
          status: 'a_contacter',
          claimed_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + SETTINGS.ttl * DAY).toISOString(),
          extended: false,
          next_action_at: null,
          contact_phone: null,
          contact_email: null,
          contact_email_kind: null,
          contact_source: null,
          released_at: null,
          release_reason: null,
        };
        this.claims.push(c);
        this.log(c, 'reserve');
        return [200, c.id];
      }
      case 'prospect_set_status': {
        const g = this.guard(s);
        if (g) return g;
        const to = String(b['p_status']);
        if (to === 'signe' || to === 'a_contacter') return pg(403, '42501', 'forbidden_status');
        const c = this.own(s!.id, b['p_claim']);
        if (!c) return pg(404, 'P0002', 'not_found');
        if (!transitionAllowed(c.status, to)) return raise('invalid_transition');
        this.applyStatus(c, to, str(b['p_next_action_at']));
        return [204, null];
      }
      case 'prospect_set_contact': {
        const g = this.guard(s);
        if (g) return g;
        const c = this.own(s!.id, b['p_claim']);
        if (!c) return pg(404, 'P0002', 'not_found');
        const phone = str(b['p_phone']);
        const email = str(b['p_email'])?.toLowerCase() ?? null;
        const source = str(b['p_source']);
        if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) return pg(400, '22023', 'invalid_phone');
        if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return pg(400, '22023', 'invalid_email');
        if ((phone || email) && !source) return pg(400, '22023', 'source_required');
        if (email && this.opposedEmails.has(email)) return raise('opposed');
        c.contact_phone = phone;
        c.contact_email = email;
        c.contact_email_kind = email ? emailKind(email, this.companies.get(c.siret)!.officers) : null;
        c.contact_source = phone || email ? source : null;
        this.log(c, 'coordonnees');
        return [200, c.contact_email_kind];
      }
      case 'prospect_add_note': {
        const g = this.guard(s);
        if (g) return g;
        const c = this.own(s!.id, b['p_claim']);
        if (!c) return pg(404, 'P0002', 'not_found');
        const body = (str(b['p_body']) ?? '').trim();
        if (!body || body.length > 2000) return pg(400, '22023', 'invalid_note');
        this.seq++;
        const id = this.newId();
        this.notes.push({ id, claim_id: c.id, stacker: s!.id, body, created_at: new Date(Date.now() + this.seq).toISOString() });
        this.log(c, 'note');
        return [200, id];
      }
      case 'prospect_delete_note': {
        const g = this.guard(s);
        if (g) return g;
        const i = this.notes.findIndex((n) => n.id === b['p_note'] && n.stacker === s!.id);
        if (i < 0) return pg(404, 'P0002', 'not_found');
        this.notes.splice(i, 1);
        return [204, null];
      }
      case 'prospect_log_call': {
        const g = this.guard(s);
        if (g) return g;
        const c = this.own(s!.id, b['p_claim']);
        if (!c) return pg(404, 'P0002', 'not_found');
        const outcome = String(b['p_outcome']);
        this.log(c, 'appel', { outcome });
        const to = outcome === 'pas_interesse' ? 'pas_interesse' : outcome === 'interesse' && (RANK[c.status] ?? 0) < 2 ? 'a_repondu' : c.status === 'a_contacter' ? 'contacte' : c.status;
        this.applyStatus(c, to, str(b['p_next_action_at']) ?? c.next_action_at);
        return [200, to];
      }
      case 'prospect_extend': {
        const g = this.guard(s);
        if (g) return g;
        const c = this.own(s!.id, b['p_claim']);
        if (!c) return pg(404, 'P0002', 'not_found');
        if (c.extended) return raise('already_extended');
        if ((RANK[c.status] ?? 0) < 1) return raise('too_early');
        c.extended = true;
        c.expires_at = new Date(new Date(c.expires_at!).getTime() + SETTINGS.extend * DAY).toISOString();
        this.log(c, 'prolonge');
        return [200, c.expires_at];
      }
      case 'prospect_release': {
        const g = this.guard(s);
        if (g) return g;
        const reason = String(b['p_reason']);
        if (reason !== 'manuel' && reason !== 'opposition') return pg(400, '22023', 'invalid_reason');
        const c = this.own(s!.id, b['p_claim']);
        if (!c) return pg(404, 'P0002', 'not_found');
        if (reason === 'opposition') this.oppose(c);
        else this.release(c, 'manuel');
        return [204, null];
      }
      case 'prospect_prepare_email': {
        const g = this.guard(s);
        if (g) return g;
        const c = this.own(s!.id, b['p_claim']);
        if (!c) return pg(404, 'P0002', 'not_found');
        if (!c.contact_email) return raise('no_email');
        if (!s!.firstName || !s!.lastName) return raise('profile_incomplete');
        const t = TEMPLATES.find((x) => x.key === b['p_template_key']);
        if (!t) return pg(400, '22023', 'unknown_template');
        if (!this.use(s!.id, 'email', SETTINGS.emailsPerDay)) return raise('daily_quota');
        const co = this.companies.get(c.siret)!;
        const initcap = (v: string) => v.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, a: string, ch: string) => a + ch.toUpperCase());
        const city = initcap(co.city ?? 'votre secteur');
        const fill = (x: string) => x.replaceAll('{{entreprise}}', initcap(co.name)).replaceAll('{{commune}}', city).replaceAll('{{prenom}}', s!.firstName!);
        const token = randomBytes(24).toString('hex');
        const site = 'https://stacker-topaz.vercel.app';
        const email: FakeEmail = {
          id: this.newId(),
          claim_id: c.id,
          stacker: s!.id,
          template_key: t.key,
          recipient: c.contact_email,
          subject: fill(t.subject),
          body: `${fill(t.body)}\n\nBien cordialement,\n${s!.firstName} ${s!.lastName}${s!.phone ? `\n${s!.phone}` : ''}`,
          footer: `${s!.firstName} ${s!.lastName}, apporteur d’affaires indépendant pour Stacker — Lucas Fernandez EI (Stacker), SIREN 891 139 248, 4 impasse Jean Roussière, 30400 Villeneuve-lès-Avignon.\nJe vous écris à l’adresse professionnelle publiée par votre entreprise ; les informations sur votre entreprise proviennent de la base SIRENE (INSEE).\nPour ne plus être contacté par Stacker : ${site}/opposition?t=${token}\nVos droits : ${site}/confidentialite`,
          token,
          marked_sent_at: null,
          created_at: new Date().toISOString(),
        };
        this.emails.push(email);
        this.log(c, 'email_prepare', { template: t.key });
        return [200, { id: email.id, recipient: email.recipient, subject: email.subject, body: email.body, footer: email.footer }];
      }
      case 'prospect_mark_email_sent': {
        const g = this.guard(s);
        if (g) return g;
        const e = this.emails.find((m) => m.id === b['p_email'] && m.stacker === s!.id);
        const c = e ? this.own(s!.id, e.claim_id) : null;
        if (!e || !c) return pg(404, 'P0002', 'not_found');
        if (!e.marked_sent_at) {
          e.marked_sent_at = new Date().toISOString();
          this.log(c, 'email_envoye', { email_id: e.id });
        }
        this.applyStatus(c, c.status === 'a_contacter' ? 'contacte' : c.status, c.next_action_at);
        return [200, c.status];
      }
      case 'my_campaign': {
        if (!s) return pg(401, '42501', 'permission denied');
        const m = this.mailboxes.get(s.id) ?? null;
        const k = this.campaigns.get(s.id) ?? null;
        const cap = k ? Math.min(k.daily_target, 20) : 0;
        return [
          200,
          {
            enabled: true,
            max_per_day: 200,
            mailbox: m ? { ...m, connected_at: new Date().toISOString(), warmup_cap: 20 } : null,
            campaign: k
              ? { ...k, cap_today: cap, queued: Math.max(0, Math.min(cap, this.campaignAvailable) - k.sent_today), failed_total: 0, replied: 0, available: this.campaignAvailable }
              : null,
          },
        ];
      }
      case 'campaign_start': {
        const g = this.guard(s);
        if (g) return g;
        if (!this.rules.has(s!.id)) return raise('rules_required');
        if (!s!.firstName || !s!.lastName) return raise('profile_incomplete');
        if (this.mailboxes.get(s!.id)?.status !== 'active') return raise('mailbox_required');
        const target = Number(b['p_daily_target']);
        if (!Number.isInteger(target) || target < 10 || target > 200) return pg(400, '22023', 'invalid_target');
        if (!TEMPLATES.some((t) => t.key === b['p_template_key'])) return pg(400, '22023', 'unknown_template');
        if (this.campaigns.has(s!.id)) return raise('campaign_exists');
        const id = this.newId();
        this.campaigns.set(s!.id, { id, department: String(b['p_department']), preset: String(b['p_preset']), daily_target: target, template_key: String(b['p_template_key']), status: 'active', created_at: new Date().toISOString(), sent_today: 0, sent_total: 0 });
        return [200, id];
      }
      case 'campaign_set_status': {
        const g = this.guard(s);
        if (g) return g;
        const k = this.campaigns.get(s!.id);
        if (!k) return pg(404, 'P0002', 'not_found');
        const status = String(b['p_status']);
        if (status === 'stopped') this.campaigns.delete(s!.id);
        else if (status === 'active' || status === 'paused') k.status = status;
        else return pg(400, '22023', 'invalid_status');
        return [204, null];
      }
      case 'mail_disconnect': {
        const g = this.guard(s);
        if (g) return g;
        this.mailboxes.delete(s!.id);
        const k = this.campaigns.get(s!.id);
        if (k) k.status = 'paused';
        return [204, null];
      }
      default:
        return null;
    }
  }

  /** Edge Function mail-connect : ici, l'autorisation est accordée aussitôt et l'app est renvoyée vers la page de retour. */
  mailConnect(b: Record<string, unknown>, s: StackerInfo | null, appOrigin: string): Reply {
    if (!s) return [401, { ok: false, error: 'unauthorized' }];
    const provider = b['provider'];
    if (provider !== 'gmail' && provider !== 'outlook') return [400, { ok: false, error: 'invalid_request' }];
    this.mailboxes.set(s.id, { provider, email: provider === 'gmail' ? 'ines.martin@gmail.com' : 'ines.martin@outlook.fr', status: 'active' });
    return [200, { ok: true, url: `${appOrigin}/app/prospects?boite=connectee` }];
  }

  private oppose(c: FakeClaim): void {
    this.opposedSirens.add(c.siret.slice(0, 9));
    if (c.contact_email) this.opposedEmails.add(c.contact_email);
    for (const x of this.claims) if (x.siret.slice(0, 9) === c.siret.slice(0, 9) && x.released_at === null && x.status !== 'signe') this.release(x, 'opposition');
  }

  /** Lecture des modèles (GET /rest/v1/email_templates). */
  templates(): unknown[] {
    return TEMPLATES.map(({ key, label }) => ({ key, label }));
  }

  /** Edge Function prospects-search (même contrat que la vraie). */
  search(b: Record<string, unknown>, s: StackerInfo | null): Reply {
    this.searchCalls.push(b);
    if (!s) return [401, { ok: false, error: 'unauthorized' }];
    if (this.searchFailNext) {
      const f = this.searchFailNext;
      this.searchFailNext = null;
      return [f.status, { ok: false, error: f.error }];
    }
    const zone = b['zone'] as { type?: string; value?: string } | undefined;
    const page = typeof b['page'] === 'number' ? b['page'] : 0;
    if (!zone || page < 1 || page > 40) return [400, { ok: false, error: 'invalid_request' }];
    if (!this.enabled) return [503, { ok: false, error: 'disabled' }];
    if (!s.onboarded) return [403, { ok: false, error: 'onboarding_required' }];
    if (!this.use(s.id, 'search', SETTINGS.searchesPerDay)) return [429, { ok: false, error: 'quota_exceeded' }];
    this.expire();
    const preset = b['preset'];
    let list = [...this.companies.values()].filter((c) => (zone.type === 'departement' ? c.department === zone.value : zone.type === 'code_postal' ? c.postcode === zone.value : true));
    if (preset === 'batiment') list = list.filter((c) => c.naf?.startsWith('43.'));
    if (preset === 'beaute') list = list.filter((c) => c.naf?.startsWith('96.'));
    list = list.filter((c) => !this.opposedSirens.has(c.siren));
    const per = 10;
    const slice = list.slice((page - 1) * per, page * per);
    const items = slice.map((c) => {
      const claim = this.claims.find((x) => x.siret === c.siret && x.released_at === null);
      const cooldown = this.cooldowns.get(c.siren) ?? 0;
      return {
        siret: c.siret,
        name: c.name,
        naf: c.naf,
        naf_label: c.naf_label,
        city: c.city,
        postcode: c.postcode,
        employee_band: c.employee_band,
        created_on: c.created_on,
        is_head_office: c.is_head_office,
        is_sole_trader: c.is_sole_trader,
        state: claim ? (claim.stacker === s.id ? 'a_moi' : 'deja_suivie') : cooldown > Date.now() ? 'en_pause' : 'libre',
        claim_id: claim?.stacker === s.id ? claim.id : null,
        cooldown_until: cooldown > Date.now() ? new Date(cooldown).toISOString() : null,
        score: c.created_on?.startsWith('2025') ? 100 : 65,
      };
    });
    return [200, { ok: true, page, total: list.length, has_more: page * per < list.length, items, quota: { used: this.used(s.id, 'search'), limit: SETTINGS.searchesPerDay } }];
  }

  /** Edge Function opposition-register (lien des emails, formulaire). */
  opposition(b: Record<string, unknown>): Reply {
    if (typeof b['token'] === 'string') {
      if (!/^[0-9a-f]{48}$/.test(b['token'])) return [400, { ok: false, error: 'invalid_request' }];
      const e = this.emails.find((m) => m.token === b['token']);
      if (e) {
        this.opposedEmails.add(e.recipient);
        const c = this.claims.find((x) => x.id === e.claim_id);
        if (c) this.oppose(c);
      }
      return [200, { ok: true }];
    }
    const siren = typeof b['siren'] === 'string' ? b['siren'].replace(/\s/g, '') : null;
    const email = typeof b['email'] === 'string' ? b['email'].trim().toLowerCase() : null;
    if ((!siren && !email) || (siren && !/^\d{9}$/.test(siren)) || typeof b['turnstileToken'] !== 'string') return [400, { ok: false, error: 'invalid_request' }];
    if (siren) {
      this.opposedSirens.add(siren);
      for (const x of this.claims) if (x.siret.startsWith(siren) && x.released_at === null && x.status !== 'signe') this.release(x, 'opposition');
    }
    if (email) this.opposedEmails.add(email);
    return [200, { ok: true }];
  }
}
