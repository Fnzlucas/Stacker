/**
 * Démo navigateur de l'app (aucune donnée réelle, aucun serveur) : la vraie
 * application, branchée sur le faux Supabase des tests e2e qui tourne dans
 * la page (fetch intercepté). Données de DÉMONSTRATION uniquement.
 * Construite à part : `node scripts/build-demo.mjs` (jamais dans le site de production).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import '../styles/app.css';
import { FakeSupabase } from '../../e2e/fake-supabase';
import { TEST_OFFERS } from '../../e2e/fake-deals';
import { App, routes } from '../app/App';
import { getBackend } from '../app/lib/supabase';

const DEMO_URL = 'https://demo.supabase.co';
const EMAIL = 'ines@demo.stacker';
const PASSWORD = 'Demo-Stacker-2026';

function seed(fake: FakeSupabase): void {
  const user = fake.seedUser({ email: EMAIL, password: PASSWORD, firstName: 'Inès', onboarded: true, activeClients: 2, profile: { last_name: 'Martin', phone: '+33611223344', department: '30' } });
  fake.admin.admins.add(user.id);
  const now = Date.now();
  const day = 86_400_000;
  ['30000001200017', '30000000500017', '30000000400017', '30000000300017'].forEach((siret, i) =>
    fake.prospects.claims.push({
      id: `00000000-0000-4000-8000-0000000001a${String(i)}`,
      stacker: user.id,
      siret,
      status: ['a_repondu', 'contacte', 'rdv', 'a_contacter'][i] ?? 'a_contacter',
      claimed_at: new Date(now - i * day).toISOString(),
      expires_at: new Date(now + 10 * day).toISOString(),
      extended: false,
      next_action_at: null,
      contact_phone: '+33490123456',
      contact_email: 'contact@entreprise-demo.fr',
      contact_email_kind: 'generique',
      contact_source: 'https://entreprise-demo.fr/contact',
      released_at: null,
      release_reason: null,
    }),
  );
  ['Menuiserie Blanc', 'Boulangerie Martin', 'Garage du Pont'].forEach((name, i) => {
    const offer = TEST_OFFERS[i % 2] ?? TEST_OFFERS[0];
    if (!offer) return;
    const id = `00000000-0000-4000-8000-0000000d000${String(i)}`;
    fake.deals.deals.push({
      id,
      reference: `STK-DEMO00${String(i)}0`,
      stacker: user.id,
      claim_id: null,
      offer,
      quantity: 1,
      monthly_price_cents: offer.price_cents,
      input: { company_name: name, siret: '30000001200017', email: 'contact@demo.fr', phone: '+33490123456', first_name: 'Paul', last_name: 'Durand', role: 'Gérant' },
      iban_last4: '0189',
      mandate_ref: `STKMDEMO00${String(i)}0`,
      contract_text: `CONTRAT DE DÉMONSTRATION\n\nCe contrat est fictif : il illustre le document signé par le client dans l’app.`,
      contract_sha256: 'a'.repeat(64),
      signature_png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      signed_at: new Date(now - (20 + i * 10) * day).toISOString(),
      withdrawal_until: new Date(now - (6 + i * 10) * day).toISOString(),
      status: 'signe',
      activated_at: null,
    });
    if (i < 2) fake.deals.recordPayment(id, '2026-10-01', offer.price_cents, i === 0 ? -1 : 9);
  });
  fake.deals.accounts.set(user.id, { holder: 'Inès Martin', iban_last4: '7034', iban: 'BE68539007547034' });
}

function headerRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(h).forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

function installFakeBackend(fake: FakeSupabase): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(DEMO_URL)) return realFetch(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const raw = typeof init?.body === 'string' ? init.body : null;
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    if (method === 'OPTIONS') return new Response(null, { status: 204 });
    await new Promise((r) => setTimeout(r, 120));
    const reply = fake.respond(method, url, headerRecord(init?.headers), body);
    if (!reply) return new Response(JSON.stringify({ message: 'route inconnue (démo)' }), { status: 404, headers: { 'content-type': 'application/json' } });
    const [status, payload] = reply;
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  };
}

/** Le faux Supabase encode ses jetons avec Buffer (Node) : équivalent navigateur minimal. */
function installBufferShim(): void {
  const g = globalThis as { Buffer?: unknown };
  if (g.Buffer) return;
  g.Buffer = {
    from: (s: string) => ({
      toString: (enc: string) => {
        const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(s)));
        return enc === 'base64url' ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
      },
    }),
  };
}

async function start(): Promise<void> {
  installBufferShim();
  const fake = new FakeSupabase();
  seed(fake);
  installFakeBackend(fake);
  const backend = getBackend();
  if (backend) await backend.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  document.getElementById('boot')?.remove();
  const ribbon = document.createElement('div');
  ribbon.className = 'demo-ribbon';
  ribbon.textContent = 'Démo · données fictives';
  document.body.append(ribbon);
  const router = createMemoryRouter(routes, { initialEntries: ['/app'] });
  const root = document.getElementById('root');
  if (root)
    createRoot(root).render(
      <StrictMode>
        <App router={router} />
      </StrictMode>,
    );
}

void start();
