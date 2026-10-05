import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page, type Route } from '@playwright/test';

export const SUPABASE = 'https://e2e-stacker.supabase.co';
export const UNCONFIGURED = 'http://localhost:4175';

export interface JoinCall {
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

export interface SupabaseMock {
  /** Valeur renvoyée par la RPC waitlist_count (null = erreur 500). */
  count: number | null;
  /** Réponse de l'Edge Function waitlist-join. */
  join: { status: number; body: unknown };
  joinCalls: JoinCall[];
  countCalls: number;
}

interface Fixtures {
  supabase: SupabaseMock;
  /** Erreurs console, exceptions et réponses 4xx/5xx inattendues : vides à la fin de chaque test. */
  problems: string[];
  /** Statuts HTTP tolérés pour ce test (ex. 404 sur la page introuvable). */
  allowStatus: number[];
}

export const test = base.extend<Fixtures>({
  allowStatus: [[], { option: true }],

  supabase: [
    async ({ page }, use) => {
      const mock: SupabaseMock = {
        count: 41,
        join: {
          status: 200,
          body: { ok: true, position: 42, referralCode: 'K7M2P9QR', referralUrl: 'http://localhost:4174/liste-attente?ref=K7M2P9QR' },
        },
        joinCalls: [],
        countCalls: 0,
      };
      await page.route(`${SUPABASE}/**`, async (route: Route) => {
        const req = route.request();
        const url = new URL(req.url());
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (url.pathname === '/rest/v1/rpc/waitlist_count') {
          mock.countCalls++;
          return mock.count === null
            ? route.fulfill({ status: 500, headers: cors, json: { message: 'boom' } })
            : route.fulfill({ status: 200, headers: cors, json: mock.count });
        }
        if (url.pathname === '/functions/v1/waitlist-join') {
          mock.joinCalls.push({ body: req.postDataJSON() as Record<string, unknown>, headers: req.headers() });
          return route.fulfill({ status: mock.join.status, headers: cors, json: mock.join.body });
        }
        return route.fulfill({ status: 404, headers: cors, json: {} });
      });
      await use(mock);
    },
    { auto: true },
  ],

  problems: [
    async ({ page, allowStatus }, use) => {
      const problems: string[] = [];
      page.on('console', (msg) => {
        // « Failed to load resource » doublonne l'écouteur « response » ci-dessous, qui sait distinguer
        // les erreurs voulues (Supabase simulé, 404 attendue) des vraies.
        if ((msg.type() === 'error' || msg.type() === 'warning') && !msg.text().startsWith('Failed to load resource')) problems.push(`console.${msg.type()} : ${msg.text()}`);
      });
      page.on('pageerror', (err) => problems.push(`pageerror : ${err.message}`));
      page.on('requestfailed', (req) => {
        // Préchargements interrompus par une navigation : comportement normal du navigateur.
        if (req.failure()?.errorText === 'net::ERR_ABORTED') return;
        problems.push(`requête échouée : ${req.url()} (${req.failure()?.errorText ?? '?'})`);
      });
      page.on('response', (res) => {
        const status = res.status();
        // Les erreurs simulées de Supabase sont voulues par le test ; seules celles du site comptent.
        if (status >= 400 && !res.url().startsWith(SUPABASE) && !allowStatus.includes(status)) problems.push(`HTTP ${String(status)} : ${res.url()}`);
      });
      await use(problems);
      expect(problems, 'aucune erreur console, exception ni requête en échec').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Aucune violation axe-core sérieuse ou critique (WCAG 2.1 A/AA). */
export async function expectAccessible(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const summary = serious.map((v) => `${v.id} (${String(v.impact)}) : ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, `axe-core sur ${label}`).toEqual([]);
}

/** Aucun débordement horizontal de la page. */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const width = doc.clientWidth;
    const offenders: string[] = [];
    if (doc.scrollWidth > width) {
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        const r = el.getBoundingClientRect();
        if (r.right > width + 1 && getComputedStyle(el).position !== 'fixed') {
          offenders.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').slice(0, 40)}`);
          if (offenders.length >= 5) break;
        }
      }
    }
    return { scrollWidth: doc.scrollWidth, width, offenders };
  });
  expect(overflow.scrollWidth, `${label} : débordement horizontal (${overflow.offenders.join(', ')})`).toBeLessThanOrEqual(overflow.width);
}
