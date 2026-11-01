/**
 * Captures pour la fiche App Store (iPhone 6,9 pouces : 1320 × 2868), à la
 * demande : APPSTORE=1.
 *   APPSTORE=1 pnpm exec playwright test e2e/appstore-shots.spec.ts --project=mobile-390
 * 1. écrans de l'app en mode « application iPhone » (aucun prix ni paiement),
 *    avec des données de DÉMONSTRATION du faux Supabase des tests ;
 * 2. mise en page App Store : fond clair de l'app, une phrase en haut, l'écran dessous.
 * Résultat dans qa/appstore/. Aucune promesse de gains dans les textes.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

test.skip(!process.env['APPSTORE'], 'captures App Store à la demande : APPSTORE=1');

const RAW = 'qa/appstore/.raw';
const OUT = 'qa/appstore';
const W = 440;
const H = 956;
const SCALE = 3;

const FRAMES: { file: string; title: string; sub: string; tone: string }[] = [
  { file: 'academy', title: 'Stacker Academy, gratuite', sub: 'Apprends à convaincre avant tes vrais appels', tone: '#f5a31e' },
  { file: 'prospects', title: 'Trouve des entreprises près de chez toi', sub: 'Par département et par secteur, avec leurs coordonnées', tone: '#3dd068' },
  { file: 'campagne', title: 'Tes emails partent tout seuls', sub: 'Depuis ta boîte, au bon rythme, en semaine', tone: '#7b7ef0' },
  { file: 'entrainement', title: 'Entraîne-toi face à l’IA', sub: 'Un commerçant décroche, objecte… et peut raccrocher', tone: '#f5a31e' },
  { file: 'bilan', title: 'Ta note sur 100', sub: 'Et des conseils précis pour ton prochain appel', tone: '#3dd068' },
  { file: 'gains', title: 'Suis tes commissions', sub: 'Client par client, débloquées au prélèvement', tone: '#7b7ef0' },
];

test('captures App Store', async ({ browser, supabase }) => {
  test.setTimeout(300_000);
  mkdirSync(RAW, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: SCALE,
    isMobile: true,
    hasTouch: true,
    baseURL: 'http://localhost:4174',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    reducedMotion: 'reduce',
  });
  // Application iPhone simulée (aucun prix, aucun paiement, pas de carte d'installation).
  await ctx.addInitScript(() => {
    const cap = Object.freeze({ isNativePlatform: () => true, getPlatform: () => 'ios' });
    Object.defineProperty(window, 'Capacitor', { get: () => cap, set: () => undefined, configurable: false });
  });
  const page = await ctx.newPage();
  await page.route('https://e2e-stacker.supabase.co/**', async (route) => {
    if (!(await supabase.fake.handle(route))) await route.fulfill({ status: 404, json: {} });
  });
  const nav = () => page.getByRole('navigation', { name: 'Navigation de l’application' });
  const shot = async (name: string, p: Page = page) => {
    await expect(p.locator('.app-splash, #boot')).toHaveCount(0);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${RAW}/${name}.png` });
  };

  // Données de démonstration.
  const user = supabase.fake.seedUser({ email: 'ines@exemple.fr', password: 'Plombier-Avignon-2026', firstName: 'Inès', onboarded: true, profile: { last_name: 'Martin', phone: '+33611223344', department: '30', city: 'Nîmes', legal_status: 'micro_entrepreneur' } });
  const fp = supabase.fake.prospects;
  fp.rules.set(user.id, '2026-10-09');
  fp.mailboxes.set(user.id, { provider: 'gmail', email: 'ines.martin@gmail.com', status: 'active' });
  fp.campaigns.set(user.id, { id: '00000000-0000-4000-8000-0000000000aa', department: '30', preset: 'batiment', daily_target: 50, template_key: 'decouverte', status: 'active', created_at: new Date().toISOString(), sent_today: 9, sent_total: 128 });
  supabase.fake.roleplay.consents.add(user.id);
  const fd = supabase.fake.deals;
  const deal = (i: number, name: string, status: 'signe' | 'actif') => ({
    id: `00000000-0000-4000-8000-0000000003a${String(i)}`,
    reference: `STK-D${String(i)}`,
    stacker: user.id,
    claim_id: null,
    offer: fd.offers[1]!,
    quantity: 1,
    monthly_price_cents: 6999,
    input: { company_name: name, siret: '73282932000074', company_address: 'Nîmes', first_name: 'A', last_name: 'B', role: 'Gérant', email: 'a@b.fr', phone: '+33600000000', iban: 'FR7630006000011234567890189' },
    iban_last4: '0189',
    mandate_ref: `RUMD${String(i)}`,
    contract_text: 'contrat',
    contract_sha256: 'a'.repeat(64),
    signature_png: 'data:image/png;base64,AAAA',
    signed_at: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
    withdrawal_until: new Date(Date.now() + (status === 'signe' ? 6 : -10) * 86_400_000).toISOString(),
    status: 'signe' as const,
    activated_at: null,
  });
  fd.deals.push(deal(1, 'Boulangerie Martin', 'actif'), deal(2, 'Garage du Pont', 'actif'), deal(3, 'Menuiserie Roux', 'signe'));
  fd.recordPayment('00000000-0000-4000-8000-0000000003a1', '2026-11-01', 6999, -1);
  fd.recordPayment('00000000-0000-4000-8000-0000000003a2', '2026-11-01', 6999, -1);

  // Connexion.
  await page.goto('/app/connexion');
  await page.getByLabel('Adresse email').fill('ines@exemple.fr');
  await page.getByLabel('Mot de passe', { exact: true }).fill('Plombier-Avignon-2026');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Bonjour Inès' })).toBeVisible();
  await shot('accueil');

  // Recherche d'entreprises.
  await nav().getByRole('link', { name: 'Prospects' }).click();
  await page.getByRole('button', { name: 'Recherche', exact: true }).click();
  await page.getByRole('button', { name: 'Artisans du bâtiment' }).click();
  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(page.locator('.pros-results')).toBeVisible();
  await page.locator('.pros-results').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 210));
  await shot('prospects');

  // Campagne en cours.
  await nav().getByRole('link', { name: 'Gains' }).click();
  await nav().getByRole('link', { name: 'Prospects' }).click();
  const run = page.getByRole('region', { name: /Artisans du bâtiment/ });
  await expect(run).toBeVisible();
  await run.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24));
  await shot('campagne');

  // Entraînement : choix, puis un appel réussi et son bilan.
  await page.goto('/app/entrainement');
  await expect(page.getByRole('heading', { level: 1, name: 'Entraînement' })).toBeVisible();
  await shot('entrainement');
  await page.getByRole('button', { name: 'Appeler Sophie' }).click();
  const say = async (text: string, reply: string) => {
    const input = page.getByLabel('Écrire ta phrase');
    await expect(input).toBeEnabled();
    await input.fill(text);
    await page.getByRole('button', { name: 'Envoyer' }).click();
    await expect(page.getByRole('log', { name: 'Conversation' }).getByText(reply)).toBeVisible();
  };
  await say('Bonjour, Inès Martin, apporteuse d’affaires indépendante pour Stacker.', 'Oui, c’est pour quoi ?');
  await say('J’ai vu que votre fiche Google indique 19 h le dimanche.', 'Ah bon, la fiche Google ?');
  await say('On tient votre fiche à jour chaque mois, pour 69 € par mois.', 'Ça coûte combien ?');
  await say('69 € par mois, sans engagement.', 'C’est avec engagement ?');
  await say('Non. Je passe jeudi à 10 h pour vous montrer ?', 'D’accord, passez jeudi à 10 h.');
  await page.getByRole('button', { name: 'Raccrocher et voir mon bilan' }).click();
  await expect(page.getByRole('heading', { name: '80/100' })).toBeVisible();
  await page.waitForTimeout(1800);
  await shot('bilan');

  // Academy, après un appel réussi (note et « passe aux vrais appels »).
  await page.goto('/app/academy');
  await expect(page.getByRole('heading', { level: 1, name: /Stacker Academy/ })).toBeVisible();
  await expect(page.locator('.academy-stats')).toContainText('80/100');
  await page.waitForTimeout(1200);
  await shot('academy');

  // Gains.
  await page.goto('/app/gains');
  await expect(page.locator('.balance-amount')).toBeVisible();
  await shot('gains');
  await ctx.close();

  // Mise en page App Store.
  mkdirSync(OUT, { recursive: true });
  const frame = await browser.newPage({ viewport: { width: 1320, height: 2868 }, deviceScaleFactor: 1 });
  for (const [i, f] of FRAMES.entries()) {
    const img = `data:image/png;base64,${readFileSync(`${RAW}/${f.file}.png`).toString('base64')}`;
    await frame.setContent(`<!doctype html><html><head><style>
      @font-face { font-family: Inter; src: local('Inter'), local('Helvetica Neue'), local('Arial'); }
      html, body { margin: 0; width: 1320px; height: 2868px; overflow: hidden; }
      body { background: #ececf0; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #121216; }
      .top { padding: 150px 110px 0; }
      .bar { width: 120px; height: 22px; border-radius: 11px; background: ${f.tone}; margin-bottom: 54px; }
      h1 { font-size: 108px; line-height: 1.04; letter-spacing: -2px; margin: 0 0 34px; font-weight: 900; }
      p { font-size: 50px; line-height: 1.3; margin: 0; color: #55555f; font-weight: 500; }
      .phone { position: absolute; left: 50%; top: 830px; width: 1000px; height: 2172px; transform: translateX(-50%); }
      .phone img { width: 100%; height: 100%; object-fit: cover; object-position: top; border-radius: 84px; display: block; box-shadow: 0 40px 120px rgba(18,18,22,.18), 0 0 0 2px rgba(18,18,22,.06); }
    </style></head><body>
      <div class="top"><div class="bar"></div><h1>${f.title}</h1><p>${f.sub}</p></div>
      <div class="phone"><img src="${img}" alt=""></div>
    </body></html>`);
    await frame.locator('.phone img').evaluate((el: HTMLImageElement) => el.decode());
    await frame.screenshot({ path: `${OUT}/${String(i + 1)}-${f.file}.png` });
  }
  await frame.close();
});
