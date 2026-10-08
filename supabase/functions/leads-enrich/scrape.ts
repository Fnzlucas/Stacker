/**
 * Lecture du site d'une entreprise pour y trouver l'adresse email GÉNÉRIQUE
 * qu'elle publie (contact@, devis@…), son SIREN (mentions légales) et son
 * téléphone. Règles :
 *   - seulement http(s), ports standard, jamais d'IP ni d'hôte interne
 *     (garde SSRF, redirections comprises) ;
 *   - robots.txt respecté, agent identifiable, 4 pages au plus, 600 Ko par
 *     page, délai court ;
 *   - jamais d'adresse devinée : uniquement une adresse écrite sur le site ;
 *   - adresses nominatives (prenom.nom@…) ignorées.
 */
import type { FetchLike } from '../_shared/rest.ts';

export const USER_AGENT = 'StackerBot/1.0 (+https://stacker-topaz.vercel.app/opposition)';
export const MAX_PAGES = 4;
export const MAX_BYTES = 600_000;
export const PAGE_TIMEOUT_MS = 6000;

export type Resolver = (host: string) => Promise<string[]>;

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\./, /^2[3-5]\d\./];

export function isPrivateIp(ip: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return PRIVATE_V4.some((re) => re.test(ip));
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:');
}

/** URL publique acceptable (avant toute requête). */
export function safeUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[') || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return null;
  url.hash = '';
  return url;
}

async function hostIsPublic(url: URL, resolve: Resolver | null): Promise<boolean> {
  if (!resolve) return true;
  try {
    const ips = await resolve(url.hostname);
    return ips.length > 0 && ips.every((ip) => !isPrivateIp(ip));
  } catch {
    return false;
  }
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const all = new Uint8Array(MAX_BYTES);
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    const take = Math.min(value.byteLength, MAX_BYTES - size);
    all.set(value.subarray(0, take), size);
    size += take;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder('utf-8', { fatal: false }).decode(all.subarray(0, size));
}

/** GET d'une page HTML avec garde SSRF à chaque redirection (3 au plus). */
export async function fetchPage(fetchFn: FetchLike, start: URL, resolve: Resolver | null): Promise<{ url: URL; html: string } | null> {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    if (!(await hostIsPublic(url, resolve))) return null;
    let res: Response;
    try {
      res = await fetchFn(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', 'accept-language': 'fr' },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const next = safeUrl(new URL(res.headers.get('location') ?? '', url).toString());
      if (!next) return null;
      url = next;
      continue;
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').toLowerCase().includes('html')) return null;
    return { url, html: await readCapped(res) };
  }
  return null;
}

/** Règles Disallow de robots.txt qui s'appliquent à notre agent. */
export function robotsDisallows(robots: string): string[] {
  const groups: { agents: string[]; rules: string[] }[] = [];
  let current: { agents: string[]; rules: string[] } | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && key === 'disallow' && value) current.rules.push(value);
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a.includes('stackerbot')));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

export const pathAllowed = (path: string, disallows: string[]): boolean => !disallows.some((rule) => path.startsWith(rule.replace(/\*.*$/, '')));

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const GENERIC_LOCAL = /^(contact|info|infos|accueil|bonjour|hello|devis|commercial|commandes?|reservations?|secretariat|administration|direction|bureau|atelier|agence|boutique|magasin|service|clients?|sav|entreprise|societe|mail|email)([._-]?[a-z0-9]*)?$/;
const PUBLIC_PROVIDERS = new Set(['gmail.com', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr', 'live.fr', 'yahoo.fr', 'yahoo.com', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net', 'icloud.com', 'gmx.fr', 'bbox.fr', 'neuf.fr']);
const NOISE_DOMAINS = /(^|\.)(example\.(com|fr)|domain\.(com|fr)|email\.(com|fr)|sentry\.io|wixpress\.com|sentry-next\.wixpress\.com|godaddy\.com|ovh\.(net|com)|ionos\.fr|o2switch\.fr|wordpress\.(com|org)|jimdo\.com|squarespace\.com|google\.com|facebook\.com)$/;
const PRIORITY = ['contact', 'devis', 'info', 'infos', 'accueil', 'bonjour', 'hello', 'commercial'];

export function decodeObfuscation(html: string): string {
  return html
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(Number.parseInt(n, 16)))
    .replace(/&commat;|&#64;/gi, '@')
    .replace(/&period;/gi, '.')
    .replace(/\s*[[(]\s*(?:at|arobase)\s*[\])]\s*/gi, '@')
    .replace(/\s*[[(]\s*(?:dot|point)\s*[\])]\s*/gi, '.');
}

const nameTokens = (name: string): string[] =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !['sarl', 'sasu', 'eurl', 'etablissements', 'entreprise', 'societe'].includes(t));

/** Adresses génériques publiées, de la plus pertinente à la moins pertinente. */
export function extractEmails(html: string, siteHost: string, businessName: string): string[] {
  const text = decodeObfuscation(html);
  const found = new Set<string>();
  for (const m of text.matchAll(/[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi)) found.add(m[0].toLowerCase().replace(/^\.+|\.+$/g, ''));
  const site = siteHost.replace(/^www\./, '');
  const tokens = nameTokens(businessName);
  const ok = [...found].filter((email) => {
    const [local = '', domain = ''] = email.split('@');
    if (NOISE_DOMAINS.test(domain) || /\.(png|jpe?g|gif|webp|svg)$/.test(domain)) return false;
    if (domain === site || domain.endsWith(`.${site}`) || site.endsWith(`.${domain}`)) return GENERIC_LOCAL.test(local);
    // Boîte grand public utilisée par l'entreprise : acceptée si elle porte son nom et n'a pas la forme prenom.nom.
    if (PUBLIC_PROVIDERS.has(domain)) return !/^[a-z]+[._-][a-z]+$/.test(local) ? tokens.some((t) => local.includes(t)) || GENERIC_LOCAL.test(local) : tokens.some((t) => local.includes(t));
    return false;
  });
  const rank = (e: string) => {
    const local = e.split('@')[0] ?? '';
    const i = PRIORITY.findIndex((p) => local.startsWith(p));
    return i < 0 ? PRIORITY.length : i;
  };
  return ok.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function extractSiren(html: string): string | null {
  const text = decodeObfuscation(html).replace(/<[^>]+>/g, ' ');
  const m = /(?:SIREN|SIRET|RCS|R\.C\.S\.?)[^0-9]{0,40}(\d{3})[\s.]?(\d{3})[\s.]?(\d{3})/i.exec(text);
  return m ? `${m[1] ?? ''}${m[2] ?? ''}${m[3] ?? ''}` : null;
}

export function extractPhone(html: string): string | null {
  const m = /href=["']tel:([+\d\s.()-]{8,20})["']/i.exec(html);
  if (!m) return null;
  const compact = (m[1] ?? '').replace(/[\s.()-]/g, '');
  if (/^0[1-9]\d{8}$/.test(compact)) return `+33${compact.slice(1)}`;
  if (/^\+33[1-9]\d{8}$/.test(compact)) return compact;
  return null;
}

/** Liens internes vers les pages contact / mentions légales. */
export function contactLinks(html: string, base: URL): URL[] {
  const out: URL[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const href = m[1] ?? '';
    const label = (m[2] ?? '').replace(/<[^>]+>/g, ' ').toLowerCase();
    if (!/contact|mentions|l[ée]gal|nous-joindre|devis/.test(`${href.toLowerCase()} ${label}`)) continue;
    try {
      const u = new URL(href, base);
      if (u.hostname === base.hostname && (u.protocol === 'https:' || u.protocol === 'http:')) {
        u.hash = '';
        if (!out.some((x) => x.toString() === u.toString())) out.push(u);
      }
    } catch {
      /* lien illisible */
    }
  }
  return out.slice(0, 3);
}

export interface SiteFindings {
  email: string | null;
  sourceUrl: string | null;
  siren: string | null;
  phone: string | null;
  pages: number;
}

/** Parcourt le site (accueil, contact, mentions légales) dans le respect de robots.txt. */
export async function scrapeSite(fetchFn: FetchLike, website: string, businessName: string, resolve: Resolver | null): Promise<SiteFindings> {
  const empty: SiteFindings = { email: null, sourceUrl: null, siren: null, phone: null, pages: 0 };
  const home = safeUrl(website);
  if (!home) return empty;
  let disallows: string[] = [];
  try {
    if (await hostIsPublic(home, resolve)) {
      const res = await fetchFn(new URL('/robots.txt', home).toString(), { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(4000) });
      if (res.ok) disallows = robotsDisallows((await res.text()).slice(0, 50_000));
    }
  } catch {
    /* pas de robots.txt lisible : on applique les règles par défaut */
  }
  const queue: URL[] = [home];
  const seen = new Set<string>();
  const result = { ...empty };
  for (let next = queue.shift(); next && result.pages < MAX_PAGES; next = queue.shift()) {
    if (seen.has(next.toString()) || !pathAllowed(next.pathname, disallows)) continue;
    seen.add(next.toString());
    const page = await fetchPage(fetchFn, next, resolve);
    if (!page) continue;
    result.pages++;
    result.siren ??= extractSiren(page.html);
    result.phone ??= extractPhone(page.html);
    if (!result.email) {
      const emails = extractEmails(page.html, home.hostname, businessName);
      if (emails[0]) {
        result.email = emails[0];
        result.sourceUrl = page.url.toString();
      }
    }
    if (result.pages === 1) {
      const links = contactLinks(page.html, page.url);
      queue.push(...(links.length ? links : [new URL('/contact', home), new URL('/mentions-legales', home)]));
    }
    if (result.email && result.siren) break;
  }
  return result;
}
