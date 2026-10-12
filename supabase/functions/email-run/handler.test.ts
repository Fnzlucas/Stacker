import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { loadEmailConfig } from './config.ts';
import { createHandler } from './handler.ts';
import { contractPdf, toBase64, winAnsi, wrap } from './pdf.ts';
import { euros, longDate, render, RenderError, type EmailItem } from './templates.ts';

const SB = 'https://proj.supabase.co';
const SECRET = 'secret-de-planification-0123456789';
const ENV = {
  SUPABASE_URL: SB,
  SUPABASE_SERVICE_ROLE_KEY: 'cle-service-factice-pour-les-tests',
  SITE_URL: 'https://stacker.example/',
  CRON_SECRET: SECRET,
  BREVO_API_KEY: 'brevo-cle-factice',
  BREVO_SENDER_EMAIL: 'bonjour@stacker.example',
  CONTACT_EMAIL: 'contact@stacker.example',
};
const CTX = { siteUrl: 'https://stacker.example', contactEmail: 'contact@stacker.example' };
/** PNG 1×1 (signature de TEST). */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const CONTRACT = [
  'CONTRAT D’ABONNEMENT ET MANDAT DE PRÉLÈVEMENT SEPA',
  '',
  '1. OBJET',
  'Le Client souscrit à l’offre Pro pour 69,99 € par mois — engagement de 12 mois.',
  'IBAN : FR76 •••• •••• 0189 · RUM STKM12345678',
  'Un mot très long : ' + 'X'.repeat(200),
  ...Array.from({ length: 80 }, (_, i) => `Ligne de remplissage ${String(i + 1)} pour tester le passage à la page suivante → ≥ ok.`),
].join('\n');

const DEAL: NonNullable<EmailItem['deal']> = {
  reference: 'STK-12345678',
  status: 'signe',
  company_name: 'Boulangerie Test',
  company_siret: '73282932000074',
  contact_name: 'Jean Dupont',
  offer_label: 'Alma Company · Pro',
  monthly_price_cents: 6999,
  mandate_ref: 'STKM12345678',
  iban_masked: 'FR•• •••• 0189',
  signed_at: '2026-10-12T08:30:00Z',
  withdrawal_until: '2026-10-26T08:30:00Z',
  first_debit_on: '2026-10-27',
  contract_text: CONTRACT,
  contract_sha256: 'a'.repeat(64),
  signature_png: PNG,
};
const item = (x: Partial<EmailItem>): EmailItem => ({ id: 1, kind: 'bienvenue', to: 'ines@exemple.fr', to_name: 'Inès Martin', data: {}, stacker: { first_name: 'Inès', last_name: 'Martin' }, deal: null, ...x });

describe('mise en forme', () => {
  it('montants, dates, caractères du PDF', () => {
    expect(euros(6999)).toBe('69,99 €');
    expect(euros(15000)).toBe('150 €');
    expect(longDate('2026-10-27')).toBe('27 octobre 2026');
    expect(longDate('2026-10-31T23:30:00Z')).toBe('1 novembre 2026');
    expect(winAnsi('Prix → 69,99 € ≥ 1 • « ok » œ 😀\t.')).toBe('Prix -> 69,99 € >= 1 • « ok » œ ?  .');
  });
  it('découpe en lignes, mots trop longs coupés', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrap(`Bonjour le monde\n\n${'Y'.repeat(300)}`, font, 10, 200);
    expect(lines[0]).toBe('Bonjour le monde');
    expect(lines[1]).toBe('');
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(200);
  });
});

describe('PDF du contrat', () => {
  it('plusieurs pages, signature, métadonnées', async () => {
    const bytes = await contractPdf({ reference: 'STK-12345678', companyName: 'Boulangerie Test', contractText: CONTRACT, contractSha256: 'a'.repeat(64), signaturePng: PNG, signedAt: DEAL.signed_at });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(doc.getTitle()).toBe('Contrat STK-12345678 — Boulangerie Test');
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');
  });
});

describe('modèles', () => {
  it('contrat au client : vouvoiement, rétractation, RUM, pré-notification promise, PDF', () => {
    const m = render(item({ kind: 'contrat_client', to: 'contact@boulangerie-test.fr', to_name: 'Jean Dupont', deal: DEAL }), CTX);
    expect(m.contract).toBe(true);
    expect(m.subject).toBe('Votre contrat Stacker STK-12345678 (Alma Company · Pro)');
    expect(m.text).toContain('Bonjour Jean Dupont,');
    expect(m.text).toContain('jusqu’au 26 octobre 2026');
    expect(m.text).toContain('Référence du mandat (RUM) : STKM12345678');
    expect(m.text).toContain('au moins 2 jours avant chaque prélèvement');
    expect(m.text).toContain('signé avec Inès Martin');
    expect(m.text).not.toContain('30006000');
    expect(m.html).toContain('69,99 € par mois');
  });
  it('contrat au stacker, pré-notification, bienvenue, abonnement, prélèvement refusé', () => {
    expect(render(item({ kind: 'contrat_stacker', deal: DEAL }), CTX)).toMatchObject({ subject: 'Deal signé : Boulangerie Test (STK-12345678)', contract: true });
    const pre = render(item({ kind: 'prenotification', to_name: null, deal: DEAL, data: { debit_on: '2026-11-27', amount_cents: 6999 } }), CTX);
    expect(pre.subject).toBe('Avis de prélèvement : 69,99 € le 27 novembre 2026');
    expect(pre.text).toContain('Bonjour,');
    expect(pre.text).toContain('Mollie');
    expect(() => render(item({ kind: 'prenotification', deal: DEAL, data: {} }), CTX)).toThrow(RenderError);
    expect(() => render(item({ kind: 'prenotification', deal: null, data: { debit_on: '2026-11-27', amount_cents: 1 } }), CTX)).toThrow('missing_deal');
    const hello = render(item({}), CTX);
    expect(hello.subject).toBe('Bienvenue sur Stacker');
    expect(hello.text).toContain('Bienvenue sur Stacker, Inès !');
    expect(hello.text).toContain('Ouvrir Stacker : https://stacker.example/app');
    expect(render(item({ stacker: null }), CTX).text).toContain('Bienvenue sur Stacker !');
    const refused = render(item({ kind: 'abonnement_refuse', data: { amount_cents: 699, grace_until: '2026-11-15' } }), CTX);
    expect(refused.text).toContain('Le paiement de 6,99 € n’est pas passé. Tu gardes l’accès jusqu’au 15 novembre 2026.');
    expect(render(item({ kind: 'abonnement_refuse', stacker: { first_name: null, last_name: null } }), CTX).text).toContain('Le paiement de ton abonnement n’est pas passé. Mets');
    expect(render(item({ kind: 'abonnement_coupe' }), CTX).text).toContain('Me réabonner : https://stacker.example/app/abonnement');
    expect(render(item({ kind: 'prelevement_refuse', deal: DEAL }), CTX).subject).toBe('Prélèvement refusé : Boulangerie Test');
  });
  it('HTML échappé', () => {
    const m = render(item({ kind: 'contrat_stacker', deal: { ...DEAL, company_name: '<b>Evil</b> & Co' } }), CTX);
    expect(m.html).toContain('&lt;b&gt;Evil&lt;/b&gt; &amp; Co');
    expect(m.html).not.toContain('<b>Evil</b>');
  });
});

describe('email-run', () => {
  const setup = (opts: { items?: unknown; brevo?: number; next?: number; env?: Record<string, string | undefined> } = {}) => {
    const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
    const sent: Record<string, unknown>[] = [];
    const logs: string[] = [];
    const handle = createHandler({
      config: loadEmailConfig(opts.env ?? ENV),
      log: (e) => void logs.push(e),
      fetch: async (url, init) => {
        const body = JSON.parse(init?.body as string) as Record<string, unknown>;
        if (url.startsWith(`${SB}/rest/v1/rpc/`)) {
          const fn = url.slice(`${SB}/rest/v1/rpc/`.length);
          rpcCalls.push({ fn, args: body });
          if (fn === 'email_schedule_prenotifications') return new Response('1');
          if (fn === 'email_next') return new Response(JSON.stringify(opts.items ?? []), { status: opts.next ?? 200 });
          return new Response('null');
        }
        sent.push({ ...body, headers: init?.headers });
        return new Response('{}', { status: opts.brevo ?? 201 });
      },
    });
    const run = (secret = SECRET, method = 'POST') => handle(new Request(`${SB}/functions/v1/email-run`, { method, headers: { 'x-cron-secret': secret } }));
    return { run, rpcCalls, sent, logs };
  };

  it('envoie, joint le contrat en PDF, enregistre le résultat', async () => {
    const s = setup({ items: [item({ id: 7, kind: 'contrat_client', to: 'contact@boulangerie-test.fr', to_name: 'Jean Dupont', deal: DEAL }), item({ id: 8 })] });
    const r = await s.run();
    expect(await r.json()).toEqual({ ok: true, scheduled: 1, sent: 2, failed: 0 });
    expect(s.rpcCalls.map((c) => c.fn)).toEqual(['email_schedule_prenotifications', 'email_next', 'email_result', 'email_result']);
    expect(s.rpcCalls[2]?.args).toEqual({ p_id: 7, p_ok: true, p_error: null });
    const first = s.sent[0] as { to: unknown; replyTo: unknown; sender: unknown; attachment: { name: string; content: string }[]; tags: string[]; headers: Record<string, string> };
    expect(first.to).toEqual([{ email: 'contact@boulangerie-test.fr', name: 'Jean Dupont' }]);
    expect(first.sender).toEqual({ email: 'bonjour@stacker.example', name: 'Stacker' });
    expect(first.replyTo).toEqual({ email: 'contact@stacker.example' });
    expect(first.headers['api-key']).toBe('brevo-cle-factice');
    expect(first.tags).toEqual(['contrat_client']);
    expect(first.attachment[0]?.name).toBe('contrat-STK-12345678.pdf');
    expect(atob(first.attachment[0]?.content ?? '').slice(0, 5)).toBe('%PDF-');
    expect((s.sent[1] as { attachment?: unknown }).attachment).toBeUndefined();
  });

  it('échecs : Brevo refuse, destinataire absent, contrat manquant', async () => {
    const s = setup({
      brevo: 500,
      items: [item({ id: 1 }), item({ id: 2, to: null }), item({ id: 3, kind: 'contrat_stacker', deal: { ...DEAL, contract_text: null } })],
    });
    expect(await (await s.run()).json()).toMatchObject({ sent: 0, failed: 3 });
    expect(s.rpcCalls.filter((c) => c.fn === 'email_result').map((c) => c.args['p_error'])).toEqual(['brevo_500', 'no_recipient', 'missing_contract']);
    expect(s.logs.filter((l) => l === 'send_failed')).toHaveLength(3);
  });

  it('accès protégé, configuration, base indisponible', async () => {
    expect((await setup().run('mauvais-secret')).status).toBe(403);
    expect((await setup().run(SECRET, 'GET')).status).toBe(405);
    expect((await setup({ env: { ...ENV, BREVO_API_KEY: undefined } }).run()).status).toBe(503);
    expect(loadEmailConfig({ ...ENV, CONTACT_EMAIL: '', BREVO_SENDER_NAME: 'Équipe Stacker' })).toMatchObject({ ok: true, config: { contactEmail: 'stacker-contact@outlook.com', brevo: { senderName: 'Équipe Stacker' } } });
    expect((await setup({ next: 500 }).run()).status).toBe(500);
    expect((await setup({ items: [{ id: 'x' }] }).run()).status).toBe(500);
  });
});
