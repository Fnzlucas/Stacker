import { describe, expect, it } from 'vitest';
import { ApiError } from './apiError';
import * as P from './prospects';
import {
  ProspectError,
  MAILTO_MAX,
  STATUSES,
  ageLabel,
  annuaireUrl,
  buildProspectMailto,
  claimProspect,
  copyText,
  dateInputToIso,
  daysLeft,
  displayName,
  eventLabel,
  fetchMyProspects,
  fetchTemplates,
  gmailComposeUrl,
  googleSearchUrl,
  isDueToday,
  isoToDateInput,
  outlookComposeUrl,
  prospectErrorMessage,
  searchProspects,
  transitionAllowed,
  type PreparedEmail,
} from './prospects';
import type { Backend } from './supabase';

const email: PreparedEmail = {
  id: '11111111-1111-4111-8111-111111111111',
  recipient: 'contact@plomberie-durand.fr',
  subject: 'Plomberie Durand : votre visibilité à Avignon',
  body: 'Bonjour,\n\nDevis & conseils #1 ?\n\nBien cordialement,\nInès Martin',
  footer: 'Inès Martin, apporteur d’affaires indépendant pour Stacker.\nPour ne plus être contacté par Stacker : https://x.fr/opposition?t=abc',
};

describe('transitions (miroir de la base)', () => {
  it('matrice', () => {
    expect(transitionAllowed('a_contacter', 'contacte')).toBe(true);
    expect(transitionAllowed('contacte', 'contacte')).toBe(true);
    expect(transitionAllowed('a_repondu', 'contacte')).toBe(false);
    expect(transitionAllowed('a_repondu', 'rdv')).toBe(true);
    expect(transitionAllowed('rdv', 'a_repondu')).toBe(true);
    expect(transitionAllowed('rdv', 'contacte')).toBe(false);
    expect(transitionAllowed('signe', 'pas_interesse')).toBe(false);
    expect(transitionAllowed('contacte', 'signe')).toBe(false);
    for (const s of STATUSES) expect(transitionAllowed(s, 'a_contacter')).toBe(false);
  });
});

describe('envoi depuis la messagerie', () => {
  it('mailto : encodage UTF-8, & et # dans le corps, pied présent', () => {
    const url = buildProspectMailto(email)!;
    expect(url.startsWith('mailto:contact@plomberie-durand.fr?subject=')).toBe(true);
    expect(url).not.toContain('&conseils');
    expect(url).toContain('%26%20conseils%20%231');
    const body = decodeURIComponent(url.split('&body=')[1] ?? '');
    expect(body).toContain('Devis & conseils #1 ?');
    expect(body).toContain('—\nInès Martin, apporteur');
    expect(body).toContain('/opposition?t=abc');
  });

  it('mailto trop long ⇒ null (le stacker utilise « Copier »)', () => {
    expect(buildProspectMailto({ ...email, body: 'é'.repeat(400) })).toBeNull();
    expect(buildProspectMailto(email)!.length).toBeLessThanOrEqual(MAILTO_MAX);
  });

  it('Gmail, Outlook, Copier', () => {
    expect(gmailComposeUrl(email)).toMatch(/^https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&to=contact@plomberie-durand\.fr&su=Plomberie%20Durand/);
    expect(outlookComposeUrl(email)).toMatch(/^https:\/\/outlook\.office\.com\/mail\/deeplink\/compose\?to=contact@plomberie-durand\.fr&subject=/);
    expect(copyText(email)).toMatch(/^À : contact@plomberie-durand\.fr\nObjet : Plomberie Durand/);
    expect(copyText(email)).toContain('opposition?t=abc');
  });

  it('liens de recherche (aucune API)', () => {
    expect(googleSearchUrl('PLOMBERIE DURAND', 'AVIGNON')).toBe('https://www.google.com/search?q=PLOMBERIE%20DURAND%20AVIGNON');
    expect(googleSearchUrl('X', null)).toBe('https://www.google.com/search?q=X');
    expect(annuaireUrl('123456789')).toBe('https://annuaire-entreprises.data.gouv.fr/entreprise/123456789');
  });
});

describe('affichage', () => {
  const now = new Date('2026-10-20T10:00:00Z');
  it('noms et âges', () => {
    expect(displayName('PLOMBERIE DURAND SARL')).toBe('Plomberie Durand SARL');
    expect(displayName('L’ATELIER DE JEAN-PAUL')).toBe('L’Atelier De Jean-Paul');
    expect(ageLabel('2025-02-01', now)).toBe('créée en 2025');
    expect(ageLabel('2010-01-01', now)).toBe('16 ans d’activité');
    expect(ageLabel(null, now)).toBeNull();
    expect(ageLabel('n/a', now)).toBeNull();
  });
  it('échéances et rappels', () => {
    expect(daysLeft('2026-10-22T09:00:00Z', now)).toBe(2);
    expect(daysLeft('2026-10-19T09:00:00Z', now)).toBe(0);
    expect(daysLeft(null, now)).toBeNull();
    expect(daysLeft('x', now)).toBeNull();
    expect(isDueToday('2026-10-20T20:00:00Z', now)).toBe(true);
    expect(isDueToday('2026-10-18T08:00:00Z', now)).toBe(true);
    expect(isDueToday('2026-10-21T08:00:00Z', now)).toBe(false);
    expect(isDueToday(null, now)).toBe(false);
  });
  it('dates des champs « prochaine action »', () => {
    expect(dateInputToIso('2026-10-22')).toBe('2026-10-22T07:00:00.000Z');
    expect(dateInputToIso('22/10/2026')).toBeNull();
    expect(dateInputToIso('2026-13-45')).toBeNull();
    expect(isoToDateInput('2026-10-22T07:00:00.000Z')).toBe('2026-10-22');
    expect(isoToDateInput(null)).toBe('');
    expect(isoToDateInput('x')).toBe('');
  });
  it('historique', () => {
    expect(eventLabel({ kind: 'statut', payload: { to: 'rdv' } })).toBe('Statut : RDV');
    expect(eventLabel({ kind: 'appel', payload: { outcome: 'rappeler' } })).toBe('Appel : à rappeler');
    expect(eventLabel({ kind: 'appel', payload: { outcome: 'inconnu' } })).toBe('Appel');
    expect(eventLabel({ kind: 'reserve', payload: {} })).toBe('Réservée');
    expect(eventLabel({ kind: 'autre', payload: {} })).toBe('Mise à jour');
  });
});

describe('erreurs', () => {
  it('codes serveur ⇒ messages', () => {
    expect(prospectErrorMessage(new ProspectError('already_claimed'))).toBe('Un autre stacker vient de réserver cette entreprise.');
    expect(prospectErrorMessage(new ProspectError('inconnu'))).toMatch(/momentanément indisponible/);
    expect(prospectErrorMessage(new ApiError('network'))).toMatch(/Connexion impossible/);
    expect(prospectErrorMessage(new ApiError('server'))).toMatch(/momentanément indisponible/);
    expect(prospectErrorMessage(new Error('x'))).toMatch(/momentanément indisponible/);
  });
});

/** Faux backend : rpc() et from().select().order() de postgrest-js. */
function backend(rpcResult: { data: unknown; error: { code?: string; message?: string } | null; status: number }, token: string | null = 'jwt'): Backend {
  return {
    url: 'https://proj.supabase.co',
    anonKey: 'anon',
    accessToken: async () => token,
    db: {
      rpc: async () => rpcResult,
      from: () => ({ select: () => ({ order: async () => rpcResult }) }),
    },
  } as unknown as Backend;
}

describe('accès aux données', () => {
  it('réponse validée, erreurs SQL converties', async () => {
    await expect(fetchMyProspects(backend({ data: [], error: null, status: 200 }))).resolves.toEqual([]);
    await expect(fetchMyProspects(backend({ data: [{ id: 'x' }], error: null, status: 200 }))).rejects.toMatchObject({ kind: 'server' });
    await expect(claimProspect(backend({ data: null, error: { code: 'P0001', message: 'already_claimed' }, status: 400 }), '1')).rejects.toMatchObject({ code: 'already_claimed' });
    await expect(claimProspect(backend({ data: null, error: { message: 'Failed to fetch' }, status: 0 }), '1')).rejects.toMatchObject({ kind: 'network' });
    await expect(claimProspect(backend({ data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 }), '1')).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(claimProspect(backend({ data: null, error: { message: 'Une erreur longue et imprévue' }, status: 500 }), '1')).rejects.toMatchObject({ kind: 'server' });
    await expect(fetchTemplates(backend({ data: [{ key: 'a', label: 'A' }], error: null, status: 200 }))).resolves.toEqual([{ key: 'a', label: 'A' }]);
    await expect(fetchTemplates(backend({ data: null, error: { message: 'boom boom' }, status: 500 }))).rejects.toMatchObject({ kind: 'server' });
    await expect(fetchTemplates(backend({ data: [{}], error: null, status: 200 }))).rejects.toMatchObject({ kind: 'server' });
  });

  it('recherche : contrat de la fonction prospects-search', async () => {
    const ok = { ok: true, page: 1, total: 0, has_more: false, items: [], quota: { used: 1, limit: 30 } };
    const call = async (status: number, body: unknown, token: string | null = 'jwt') =>
      searchProspects(backend({ data: null, error: null, status: 200 }, token), { zone: { type: 'departement', value: '30' }, page: 1 }, async () => new Response(JSON.stringify(body), { status }));
    await expect(call(200, ok)).resolves.toMatchObject({ total: 0, hasMore: false, quota: { used: 1 } });
    await expect(call(429, { ok: false, error: 'quota_exceeded' })).rejects.toMatchObject({ code: 'quota_exceeded' });
    await expect(call(401, { ok: false, error: 'unauthorized' })).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(call(500, '<html>')).rejects.toMatchObject({ kind: 'server' });
    await expect(call(200, ok, null)).rejects.toMatchObject({ kind: 'unauthorized' });
    await expect(
      searchProspects(backend({ data: null, error: null, status: 200 }), { zone: { type: 'departement', value: '30' }, page: 1 }, async () => {
        throw new Error('réseau');
      }),
    ).rejects.toMatchObject({ kind: 'network' });
    await expect(
      searchProspects(backend({ data: null, error: null, status: 200 }), { zone: { type: 'departement', value: '30' }, page: 1 }, async () => new Response('pas du json', { status: 502 })),
    ).rejects.toMatchObject({ kind: 'server' });
  });
});

describe('chaque appel serveur envoie les bons arguments', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const calls: { fn: string; args: unknown }[] = [];
  const b = (data: unknown) =>
    ({
      url: 'u',
      anonKey: 'a',
      accessToken: async () => 'jwt',
      db: {
        rpc: async (fn: string, args: unknown) => {
          calls.push({ fn, args });
          return { data, error: null, status: 200 };
        },
      },
    }) as unknown as Backend;
  const detail = {
    claim: { id: ID, status: 'contacte', claimed_at: 'x', expires_at: null, extended: false, next_action_at: null, contact_phone: null, contact_email: null, contact_email_kind: null, contact_source: null },
    company: { siret: '1', siren: '1', name: 'X', naf: null, naf_label: null, employee_band: null, is_sole_trader: false, created_on: null, address: null, postcode: null, city: null, officers: [] },
    notes: [],
    events: [],
    emails: [],
  };
  const quotas = { enabled: true, rules_version: null, searches: { used: 0, limit: 30 }, claims_today: { used: 0, limit: 15 }, emails_today: { used: 0, limit: 40 }, active: { used: 0, limit: 40 } };
  it('arguments nommés p_* et réponses validées', async () => {
    await P.fetchProspect(b(detail), ID);
    await P.fetchQuotas(b(quotas));
    await P.acceptRules(b(null));
    await P.setStatus(b(null), ID, 'rdv', null);
    await P.setContact(b('generique'), ID, { phone: '+33490000000', email: 'a@b.fr', source: 's' });
    await P.addNote(b(ID), ID, 'note');
    await P.deleteNote(b(null), ID);
    await P.logCall(b('contacte'), ID, 'messagerie', null);
    await P.extendClaim(b('2026-11-01T00:00:00Z'), ID);
    await P.releaseClaim(b(null), ID, 'manuel');
    await P.prepareEmail(b({ ...email }), ID, 'decouverte');
    await P.markEmailSent(b('contacte'), ID);
    expect(calls.map((c) => c.fn)).toEqual([
      'prospect_detail',
      'my_prospect_quotas',
      'accept_prospecting_rules',
      'prospect_set_status',
      'prospect_set_contact',
      'prospect_add_note',
      'prospect_delete_note',
      'prospect_log_call',
      'prospect_extend',
      'prospect_release',
      'prospect_prepare_email',
      'prospect_mark_email_sent',
    ]);
    expect(calls[3]?.args).toEqual({ p_claim: ID, p_status: 'rdv', p_next_action_at: null });
    expect(calls[4]?.args).toEqual({ p_claim: ID, p_phone: '+33490000000', p_email: 'a@b.fr', p_source: 's' });
    expect(calls[2]?.args).toEqual({ p_version: P.PROSPECTING_RULES_VERSION });
  });
});
