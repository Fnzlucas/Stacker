-- Lot 3 : intrusion et confidentialité. B tente de lire et de modifier les
-- prospects de A ; anon tente tout ; aucune écriture directe n'est possible ;
-- coordonnées, emails préparés (pied légal serveur) et liste d'opposition.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(53);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Alice"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Bob"}');
update public.profiles set onboarding_completed_at = now(), department = '84'
where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

select public.prospects_cache_put(repeat('c', 64), '{}', 3, '[
  {"siret": "30000000100011", "name": "Plomberie Durand", "naf": "43.22A", "naf_label": "Travaux de plomberie", "city": "AVIGNON", "postcode": "84000",
   "officers": [{"nom": "DURAND", "prenoms": "Paul", "qualite": "Gérant"}]},
  {"siret": "30000000200011", "name": "Garage Martin", "city": "ORANGE", "postcode": "84100"},
  {"siret": "30000000300011", "name": "Coiffure Léa", "city": "CARPENTRAS", "postcode": "84200"}
]'::jsonb);

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select lives_ok($$select public.prospect_claim('30000000100011')$$, 'A réserve Plomberie Durand');
create temporary table t_a on commit drop as select id from public.prospect_claims where siret = '30000000100011';
grant select on t_a to authenticated, anon;

-- Coordonnées
select throws_ok($$select public.prospect_set_contact((select id from t_a), '0612345678', null, 'site')$$, '22023', 'invalid_phone', 'téléphone hors E.164 ⇒ invalid_phone');
select throws_ok($$select public.prospect_set_contact((select id from t_a), null, 'pas-un-email', 'site')$$, '22023', 'invalid_email', 'email invalide ⇒ invalid_email');
select throws_ok($$select public.prospect_set_contact((select id from t_a), '+33490000000', null, '')$$, '22023', 'source_required', 'coordonnée sans source ⇒ source_required');
select is(public.prospect_set_contact((select id from t_a), '+33490000000', 'Contact@Plomberie-Durand.fr', 'https://plomberie-durand.fr/contact'),
          'generique', 'contact@… classé générique (et mis en minuscules)');
select is(public.prospect_set_contact((select id from t_a), '+33490000000', 'paul.durand@plomberie-durand.fr', 'https://plomberie-durand.fr'), 'nominatif', 'paul.durand@… ⇒ nominatif');
select is(public.prospect_set_contact((select id from t_a), '+33490000000', 'pdurand@plomberie-durand.fr', 'https://plomberie-durand.fr'), 'nominatif', 'pdurand@… (nom du dirigeant) ⇒ nominatif');
select is(public.prospect_set_contact((select id from t_a), '+33490000000', 'j.dupont@plomberie-durand.fr', 'https://plomberie-durand.fr'), 'nominatif', 'j.dupont@… ⇒ nominatif');
select is(public.prospect_set_contact((select id from t_a), '+33490000000', 'contact@plomberie-durand.fr', 'https://plomberie-durand.fr/contact'), 'generique', 'retour à contact@… ⇒ générique');

-- Notes
select lives_ok($$select public.prospect_add_note((select id from t_a), '  Rappeler mardi matin  ')$$, 'A ajoute une note');
select is((select body from public.prospect_notes), 'Rappeler mardi matin', '... espaces retirés');
select throws_ok($$select public.prospect_add_note((select id from t_a), '   ')$$, '22023', 'invalid_note', 'note vide ⇒ invalid_note');

-- Email préparé : pied légal serveur
select throws_ok($$select public.prospect_prepare_email((select id from t_a), 'decouverte')$$, 'P0001', 'profile_incomplete', 'sans nom de famille ⇒ profile_incomplete (expéditeur identifiable)');
reset role;
update public.profiles set last_name = 'Martin', phone = '+33611223344' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select throws_ok($$select public.prospect_prepare_email((select id from t_a), 'inconnu')$$, '22023', 'unknown_template', 'modèle inconnu ⇒ unknown_template');
create temporary table t_mail on commit drop as select public.prospect_prepare_email((select id from t_a), 'decouverte') as m;
grant select on t_mail to authenticated;
select is((select m ->> 'recipient' from t_mail), 'contact@plomberie-durand.fr', 'email préparé pour l''adresse saisie');
select is((select m ->> 'subject' from t_mail), 'Plomberie Durand : votre visibilité à Avignon', 'objet rendu (entreprise, commune)');
select ok((select (m ->> 'body') like '%Bien cordialement,%Alice Martin%+33611223344' from t_mail), 'signature : prénom, nom, téléphone du stacker');
select ok((select (m ->> 'footer') like 'Alice Martin, apporteur d''affaires indépendant pour Stacker — Lucas Fernandez EI%SIREN 891 139 248%' from t_mail), 'pied : expéditeur réel et éditeur identifiés');
select ok((select (m ->> 'footer') ~ '/opposition\?t=[0-9a-f]{48}' from t_mail), 'pied : lien d''opposition à jeton');
select ok((select (m ->> 'footer') like '%base SIRENE (INSEE)%/confidentialite' from t_mail), 'pied : source des données et lien vers les droits');
select is((select status::text from public.prospect_claims where id = (select id from t_a)), 'a_contacter', 'préparer n''est pas envoyer : statut inchangé');
select is(public.prospect_mark_email_sent((select (m ->> 'id')::uuid from t_mail))::text, 'contacte', '« Je l''ai envoyé » ⇒ contacté');
select is((select count(*)::int from public.prospect_emails where marked_sent_at is not null), 1, '... horodaté');
reset role;

-- ---------------------------------------------------------------- B attaque
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select is((select count(*)::int from public.prospect_claims), 0, 'B : 0 réservation de A visible');
select is((select count(*)::int from public.prospect_notes), 0, 'B : 0 note de A visible');
select is((select count(*)::int from public.prospect_emails), 0, 'B : 0 email de A visible');
select is((select count(*)::int from public.prospect_events), 0, 'B : 0 événement de A visible');
select is((select count(*)::int from public.companies), 0, 'B : 0 entreprise visible (pas de lecture en masse)');
select throws_ok($$select public.prospect_set_status((select id from t_a), 'rdv')$$, 'P0002', 'not_found', 'B : changer le statut de A ⇒ not_found');
select throws_ok($$select public.prospect_add_note((select id from t_a), 'pirate')$$, 'P0002', 'not_found', 'B : noter chez A ⇒ not_found');
select throws_ok($$select public.prospect_set_contact((select id from t_a), null, 'x@y.fr', 'x')$$, 'P0002', 'not_found', 'B : modifier les coordonnées de A ⇒ not_found');
select throws_ok($$select public.prospect_release((select id from t_a), 'manuel')$$, 'P0002', 'not_found', 'B : libérer la réservation de A ⇒ not_found');
select throws_ok($$select public.prospect_detail((select id from t_a))$$, 'P0002', 'not_found', 'B : lire la fiche de A ⇒ not_found');
select throws_ok($$select public.prospect_prepare_email((select id from t_a), 'decouverte')$$, 'P0002', 'not_found', 'B : préparer un email chez A ⇒ not_found');
select throws_ok($$select public.prospect_mark_email_sent((select (m ->> 'id')::uuid from t_mail))$$, 'P0002', 'not_found', 'B : marquer l''email de A envoyé ⇒ not_found');
select throws_ok($$insert into public.prospect_claims (stacker_id, siret, expires_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '30000000200011', now() + interval '1 day')$$, '42501', null, 'B : INSERT direct d''une réservation ⇒ refusé');
select throws_ok($$update public.prospect_claims set status = 'signe'$$, '42501', null, 'B : UPDATE direct ⇒ refusé');
select throws_ok($$delete from public.prospect_notes$$, '42501', null, 'B : DELETE direct de notes ⇒ refusé');
select throws_ok($$select * from public.opposition_list$$, '42501', null, 'B : lecture de la liste d''opposition ⇒ refusée');
select throws_ok($$select * from public.usage_counters$$, '42501', null, 'B : lecture des compteurs ⇒ refusée');
select throws_ok($$select * from public.company_search_cache$$, '42501', null, 'B : lecture du cache ⇒ refusée');
select throws_ok($$select * from public.app_secrets$$, '42501', null, 'B : lecture des secrets ⇒ refusée');
select throws_ok($$select public.prospects_annotate('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', array['30000000100011'])$$, '42501', null, 'B : annotate (service) ⇒ refusé');
select throws_ok($$select public.prospect_mark_signed((select id from t_a), 'x')$$, '42501', null, 'B : marquer signé (service) ⇒ refusé');
select throws_ok($$select public.opposition_register_form('300000001', null)$$, '42501', null, 'B : formulaire d''opposition (service) ⇒ refusé');
reset role;

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select * from public.prospect_claims$$, '42501', null, 'anon : SELECT prospect_claims ⇒ refusé');
select throws_ok($$select public.my_prospects()$$, '42501', null, 'anon : my_prospects() ⇒ refusé');
select throws_ok($$select public.prospect_claim('30000000200011')$$, '42501', null, 'anon : prospect_claim() ⇒ refusé');
reset role;

-- ---------------------------------------------------------------- opposition par le lien de l'email
select ok(public.opposition_register_token((select substring(m ->> 'footer' from 't=([0-9a-f]{48})') from t_mail)), 'lien d''opposition : pris en compte');
select ok(public.opposition_register_token((select substring(m ->> 'footer' from 't=([0-9a-f]{48})') from t_mail)), '... idempotent');
select is((select count(*)::int from public.opposition_list where kind = 'siren'), 1, '... une seule ligne SIREN (pas de doublon)');
select is((select release_reason::text from public.prospect_claims where id = (select id from t_a)), 'opposition', '... la réservation de A est libérée');
select is(jsonb_array_length(public.prospects_annotate('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', array['30000000100011', '30000000200011'])), 1,
          '... et l''entreprise n''apparaît plus dans les recherches');

select * from finish();
rollback;
