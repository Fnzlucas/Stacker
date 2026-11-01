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
const NEW_EMAIL = 'nouveau@demo.stacker';

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
  // Une campagne en cours, une boîte connectée, les règles acceptées.
  fake.prospects.rules.set(user.id, '2026-10-09');
  fake.prospects.mailboxes.set(user.id, { provider: 'gmail', email: 'ines.martin@gmail.com', status: 'active' });
  fake.prospects.campaigns.set(user.id, { id: '00000000-0000-4000-8000-0000000000aa', department: '30', preset: 'batiment', daily_target: 50, template_key: 'decouverte', status: 'active', created_at: new Date(now - 6 * day).toISOString(), sent_today: 9, sent_total: 74 });
  // Un compte tout neuf, pour voir l'inscription (onboarding).
  fake.seedUser({ email: NEW_EMAIL, password: PASSWORD, firstName: 'Léa', onboarded: false });
}

/** Menu de la démo : tous les écrans, connecté ou non. */
const SCREENS: { group: string; items: { label: string; path: string; as?: 'out' | 'new' | 'ines'; intro?: boolean }[] }[] = [
  {
    group: 'Avant connexion',
    items: [
      { label: 'Présentation (premier lancement)', path: '/app/demarrer', as: 'out', intro: true },
      { label: 'Écran de démarrage', path: '/app/demarrer', as: 'out' },
      { label: 'Créer un compte', path: '/app/inscription', as: 'out' },
      { label: 'Se connecter', path: '/app/connexion', as: 'out' },
      { label: 'Inscription : questions et premier pas', path: '/app/bienvenue', as: 'new' },
    ],
  },
  {
    group: 'Academy',
    items: [
      { label: 'Academy', path: '/app/academy' },
      { label: 'Appel d’entraînement', path: '/app/entrainement' },
      { label: 'Formation', path: '/app/formation' },
    ],
  },
  {
    group: 'Pro',
    items: [
      { label: 'Accueil', path: '/app' },
      { label: 'Prospects et campagne', path: '/app/prospects' },
      { label: 'Fiche d’un prospect', path: '/app/prospects/00000000-0000-4000-8000-0000000001a0' },
      { label: 'Deals', path: '/app/deals' },
      { label: 'Faire signer un client', path: '/app/deals/nouveau' },
      { label: 'Gains', path: '/app/gains' },
    ],
  },
  {
    group: 'Compte',
    items: [
      { label: 'Formules et abonnement', path: '/app/abonnement' },
      { label: 'Profil', path: '/app/profil' },
      { label: 'Espace admin', path: '/app/admin' },
    ],
  },
];

function installScreensMenu(go: (path: string, as: 'out' | 'new' | 'ines', intro: boolean) => Promise<void>): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'demo-menu-btn';
  button.textContent = '☰ Écrans';
  const panel = document.createElement('nav');
  panel.className = 'demo-menu';
  panel.setAttribute('aria-label', 'Écrans de la démo');
  panel.hidden = true;
  for (const g of SCREENS) {
    const h = document.createElement('p');
    h.className = 'demo-menu-group';
    h.textContent = g.group;
    panel.append(h);
    for (const item of g.items) {
      const a = document.createElement('button');
      a.type = 'button';
      a.textContent = item.label;
      a.addEventListener('click', () => {
        panel.hidden = true;
        void go(item.path, item.as ?? 'ines', item.intro === true);
      });
      panel.append(a);
    }
  }
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });
  document.body.append(panel, button);
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
  const router = createMemoryRouter(routes, { initialEntries: ['/app/academy'] });
  let who: 'out' | 'new' | 'ines' = 'ines';
  installScreensMenu(async (path, as, intro) => {
    try {
      if (intro) window.localStorage.removeItem('stk-intro-seen');
      else window.localStorage.setItem('stk-intro-seen', '1');
    } catch {
      /* stockage indisponible */
    }
    // Repasser par une autre page : l'écran d'accueil relit l'état de la présentation.
    if (path === '/app/demarrer') {
      await router.navigate('/app/connexion');
      await new Promise((r) => setTimeout(r, 300));
    }
    if (backend && as !== who) {
      await backend.auth.signOut();
      if (as !== 'out') await backend.auth.signInWithPassword({ email: as === 'new' ? NEW_EMAIL : EMAIL, password: PASSWORD });
      who = as;
      // Laisse l'app prendre en compte la (dé)connexion avant d'ouvrir l'écran.
      await new Promise((r) => setTimeout(r, 700));
    }
    await router.navigate(path);
    window.scrollTo(0, 0);
  });
  const root = document.getElementById('root');
  if (root)
    createRoot(root).render(
      <StrictMode>
        <App router={router} />
      </StrictMode>,
    );
}

void start();
