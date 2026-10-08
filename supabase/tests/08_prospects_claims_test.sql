-- Lot 3 : réservations. Règles de prise (exclusivité, gel, quotas, reprise),
-- matrice des transitions, échéances 10/21/30 j, prolongation unique,
-- expiration, « signé » réservé au serveur, journal append-only.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(59);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Alice"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Bob"}'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'chloe@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Chloé"}');
update public.profiles set onboarding_completed_at = now(), department = '30'
where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
-- Chloé n'a pas fini l'onboarding.

-- 50 entreprises (cache de recherche, comme le ferait prospects-search).
select public.prospects_cache_put(
  repeat('a', 64), '{"t": 1}', 50,
  (select jsonb_agg(jsonb_build_object(
     'siret', '1' || lpad(i::text, 8, '0') || '00011', 'name', 'Entreprise ' || i, 'naf', '43.22A', 'naf_label', 'Plomberie',
     'city', 'AVIGNON', 'postcode', '84000', 'department', '84',
     'officers', '[{"nom": "DUPONT", "prenoms": "Jean", "qualite": "Gérant"}]'::jsonb) order by i)
   from generate_series(1, 25) i)
);
select public.prospects_cache_put(
  repeat('b', 64), '{"t": 2}', 50,
  (select jsonb_agg(jsonb_build_object('siret', '2' || lpad(i::text, 8, '0') || '00011', 'name', 'Société ' || i) order by i)
   from generate_series(1, 25) i)
);
select is((select count(*)::int from public.companies), 50, 'prospects_cache_put : 50 entreprises enregistrées');
select is((select total from public.company_search_cache where key = repeat('a', 64)), 50, '... et la page mise en cache');

-- ---------------------------------------------------------------- Chloé (non onboardée)
set local role authenticated;
set local request.jwt.claims = '{"sub": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "role": "authenticated"}';
select throws_ok($$select public.prospect_claim('100000001' || '00011')$$, 'P0001', 'onboarding_required', 'onboarding non terminé ⇒ onboarding_required');
reset role;

-- ---------------------------------------------------------------- Alice réserve
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select throws_ok($$select public.prospect_claim('123')$$, '22023', 'invalid_siret', 'SIRET mal formé ⇒ invalid_siret');
select throws_ok($$select public.prospect_claim('99999999900011')$$, 'P0002', 'unknown_company', 'entreprise jamais vue ⇒ unknown_company');
select lives_ok($$select public.prospect_claim('10000000100011')$$, 'A réserve une entreprise');
select is((select status::text from public.prospect_claims where siret = '10000000100011'), 'a_contacter', '... statut initial « à contacter »');
select ok((select expires_at between now() + interval '9 days 23 hours' and now() + interval '10 days 1 hour'
           from public.prospect_claims where siret = '10000000100011'), '... échéance à 10 jours');
select is((select count(*)::int from public.prospect_events where kind = 'reserve'), 1, '... événement « reserve » journalisé');
select is((select count(*)::int from public.companies), 1, 'A ne lit QUE l''entreprise qu''elle a réservée');
select throws_ok($$select public.prospect_claim('10000000100011')$$, 'P0001', 'already_claimed', 'réserver deux fois ⇒ already_claimed');
reset role;

-- ---------------------------------------------------------------- Bob : exclusivité
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select throws_ok($$select public.prospect_claim('10000000100011')$$, 'P0001', 'already_claimed', 'B : entreprise suivie par A ⇒ already_claimed');
select is((select count(*)::int from public.companies), 0, 'B ne lit pas l''entreprise suivie par A');
select is(jsonb_array_length(public.my_prospects()), 0, 'B : my_prospects() vide');
reset role;
select is(
  (select string_agg(x ->> 'state', ',') from jsonb_array_elements(public.prospects_annotate('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', array['10000000100011', '20000000100011'])) x),
  'deja_suivie,libre', 'annotate pour B : « déjà suivie » puis « libre »');
select is(
  (select x ->> 'state' from jsonb_array_elements(public.prospects_annotate('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['10000000100011'])) x),
  'a_moi', 'annotate pour A : « à moi »');
select is(
  (select count(*)::int from jsonb_array_elements(public.prospects_annotate('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', array['10000000100011'])) x
   where x ? 'stacker_id' or x ? 'status' or x ? 'contact_email'),
  0, 'annotate ne révèle ni le stacker, ni le statut, ni les coordonnées');

-- ---------------------------------------------------------------- transitions
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
create temporary table t_claim on commit drop as select id from public.prospect_claims where siret = '10000000100011';
grant select on t_claim to authenticated;

select throws_ok($$select public.prospect_set_status((select id from t_claim), 'signe')$$, '42501', 'forbidden_status', '« signé » posé par le stacker ⇒ forbidden_status');
select throws_ok($$select public.prospect_set_status((select id from t_claim), 'a_contacter')$$, '42501', 'forbidden_status', 'retour à « à contacter » ⇒ forbidden_status');
select throws_ok($$select public.prospect_extend((select id from t_claim))$$, 'P0001', 'too_early', 'prolonger avant le premier contact ⇒ too_early');
select lives_ok($$select public.prospect_set_status((select id from t_claim), 'contacte')$$, 'à contacter → contacté');
select ok((select expires_at > now() + interval '20 days' from public.prospect_claims where id = (select id from t_claim)), '... échéance portée à 21 jours');
select lives_ok($$select public.prospect_set_status((select id from t_claim), 'contacte')$$, 'contacté → contacté (relance)');
select lives_ok($$select public.prospect_set_status((select id from t_claim), 'a_repondu', now() + interval '2 days')$$, 'contacté → a répondu (avec prochaine action)');
select throws_ok($$select public.prospect_set_status((select id from t_claim), 'contacte')$$, 'P0001', 'invalid_transition', 'a répondu → contacté ⇒ invalid_transition');
select lives_ok($$select public.prospect_set_status((select id from t_claim), 'rdv')$$, 'a répondu → RDV');
select ok((select expires_at > now() + interval '29 days' from public.prospect_claims where id = (select id from t_claim)), '... échéance portée à 30 jours');
select lives_ok($$select public.prospect_set_status((select id from t_claim), 'a_repondu')$$, 'RDV → a répondu (RDV annulé)');
select throws_ok($$select public.prospect_set_status((select id from t_claim), 'rdv', now() + interval '1 year')$$, '22023', 'invalid_next_action', 'prochaine action dans un an ⇒ refusée');
select lives_ok($$select public.prospect_extend((select id from t_claim))$$, 'prolongation de 7 jours');
select throws_ok($$select public.prospect_extend((select id from t_claim))$$, 'P0001', 'already_extended', 'seconde prolongation ⇒ already_extended');

-- Appels
select lives_ok($$select public.prospect_claim('10000000200011')$$, 'A réserve une 2e entreprise');
select is(
  (select public.prospect_log_call((select id from public.prospect_claims where siret = '10000000200011'), 'messagerie')::text),
  'contacte', 'appel « messagerie » sur une fiche à contacter ⇒ contacté');
select is(
  (select public.prospect_log_call((select id from public.prospect_claims where siret = '10000000200011'), 'interesse', now() + interval '1 day')::text),
  'a_repondu', 'appel « intéressé » ⇒ a répondu');
select is(
  (select count(*)::int from public.prospect_events where kind = 'appel'), 2, '... deux appels journalisés');
select is(
  (select public.prospect_log_call((select id from public.prospect_claims where siret = '10000000200011'), 'pas_interesse')::text),
  'pas_interesse', 'appel « pas intéressé » ⇒ libération');
select is((select count(*)::int from public.prospect_claims where siret = '10000000200011' and released_at is null), 0, '... la réservation est libérée');
reset role;
select ok((select until > now() + interval '179 days' from public.company_cooldowns where siren = '100000002'), '... et l''entreprise gelée 180 jours pour tous');
select is(
  (select x ->> 'state' from jsonb_array_elements(public.prospects_annotate('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', array['10000000200011'])) x),
  'en_pause', 'annotate : entreprise gelée « en pause »');
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select throws_ok($$select public.prospect_claim('10000000200011')$$, 'P0001', 'cooldown', 'B : entreprise gelée ⇒ cooldown');
reset role;

-- ---------------------------------------------------------------- libération, reprise, expiration
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select lives_ok($$select public.prospect_claim('10000000300011')$$, 'A réserve une 3e entreprise');
select lives_ok($$select public.prospect_release((select id from public.prospect_claims where siret = '10000000300011' and released_at is null), 'manuel')$$, 'A la libère');
select throws_ok($$select public.prospect_claim('10000000300011')$$, 'P0001', 'reclaim_blocked', 'A la reprend tout de suite ⇒ reclaim_blocked (30 j)');
select throws_ok($$select public.prospect_release((select id from t_claim), 'pirate')$$, '22023', 'invalid_reason', 'motif de libération inconnu ⇒ invalid_reason');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select lives_ok($$select public.prospect_claim('10000000300011')$$, 'B peut prendre l''entreprise libérée par A');
reset role;

-- Échéance dépassée : la réservation retourne au pool.
update public.prospect_claims set expires_at = now() - interval '1 minute' where siret = '10000000300011' and released_at is null;
select is(public.prospect_expire_due(), 1, 'prospect_expire_due() libère la réservation échue');
select is((select release_reason::text from public.prospect_claims where siret = '10000000300011' order by claimed_at desc limit 1), 'expire', '... motif « expire »');
select is((select count(*)::int from public.prospect_events e join public.prospect_claims c on c.id = e.claim_id
           where c.siret = '10000000300011' and e.kind = 'expire'), 1, '... événement « expire »');

-- 3 réservations sur 12 mois : la 4e est refusée.
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
reset role;
insert into public.prospect_claims (stacker_id, siret, released_at, release_reason, expires_at) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '10000000400011', now() - interval '60 days', 'manuel', now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '10000000400011', now() - interval '50 days', 'manuel', now()),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '10000000400011', now() - interval '40 days', 'manuel', now());
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select throws_ok($$select public.prospect_claim('10000000400011')$$, 'P0001', 'company_quota', '4e réservation de la même entreprise en 12 mois ⇒ company_quota');
reset role;

-- Quotas : 15 nouvelles par jour, 40 actives.
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select lives_ok($$select public.prospect_claim('2' || lpad(i::text, 8, '0') || '00011') from generate_series(1, 14) i$$, 'B : 14 réservations de plus (15 aujourd''hui)');
select throws_ok($$select public.prospect_claim('20000001500011')$$, 'P0001', 'daily_quota', 'B : 16e réservation du jour ⇒ daily_quota');
select is((public.my_prospect_quotas() -> 'claims_today' ->> 'used')::int, 15, 'my_prospect_quotas : 15/15 aujourd''hui');
reset role;
update public.usage_counters set count = 0 where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and metric = 'claim';
update public.prospect_settings set max_active_claims = 14;
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select throws_ok($$select public.prospect_claim('20000001600011')$$, 'P0001', 'max_active', 'B : au-delà des réservations actives permises ⇒ max_active');
reset role;
update public.prospect_settings set max_active_claims = 40;

-- Interrupteur
update public.app_flags set enabled = false where key = 'prospects_enabled';
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select throws_ok($$select public.prospect_claim('20000001600011')$$, 'P0001', 'disabled', 'prospection coupée ⇒ disabled');
reset role;
update public.app_flags set enabled = true where key = 'prospects_enabled';

-- ---------------------------------------------------------------- signé (serveur)
select lives_ok($$select public.prospect_mark_signed((select id from t_claim), 'deal-1')$$, 'service : prospect_mark_signed');
select is((select status::text || '/' || coalesce(expires_at::text, 'permanent') from public.prospect_claims where id = (select id from t_claim)),
          'signe/permanent', '... statut « signé », réservation permanente');
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select throws_ok($$select public.prospect_set_status((select id from t_claim), 'pas_interesse')$$, 'P0001', 'invalid_transition', 'un client signé ne repasse pas « pas intéressé »');
reset role;

-- ---------------------------------------------------------------- journal append-only
select throws_ok($$update public.prospect_events set kind = 'note'$$, '42501', 'prospect_events_append_only', 'UPDATE du journal ⇒ refusé');
select throws_ok($$delete from public.prospect_events$$, '42501', 'prospect_events_append_only', 'DELETE du journal ⇒ refusé');

select * from finish();
rollback;
