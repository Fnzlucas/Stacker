-- Lot 10 : entraînement à l'appel face à une IA. Sessions écrites seulement
-- par la fonction serveur, quotas, réussite, cloisonnement, blocage de la
-- signature tant qu'aucune simulation n'est réussie (interrupteur), export RGPD.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(36);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Alice"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Bob"}'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'chloe@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Chloé"}');
update public.profiles set onboarding_completed_at = now(), department = '30', last_name = 'Martin'
where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

create temporary table t_s (k text primary key, id uuid) on commit drop;
grant all on t_s to authenticated, service_role;
create temporary table t_in (j jsonb) on commit drop;
insert into t_in values ('{"offer_id": "alma-pro", "quantity": 1, "siret": "73282932000074", "company_name": "Boulangerie Test",
  "company_address": "1 rue de la Paix, 30000 Nîmes", "first_name": "Jean", "last_name": "Dupont", "role": "Gérant",
  "email": "contact@boulangerie-test.fr", "phone": "+33612345678", "iban_holder": "Boulangerie Test",
  "iban": "FR7630006000011234567890189", "accept_terms": true, "accept_mandate": true}');
grant select on t_in to authenticated, service_role;
create temporary table t_sig (s text) on commit drop;
insert into t_sig values ('data:image/png;base64,' || repeat('iVBORw0KGgo', 300));
grant select on t_sig to authenticated, service_role;

-- ---------------------------------------------------------------- accès
set local role anon;
select throws_ok($$select public.my_roleplay()$$, '42501', null, 'anon : my_roleplay refusé');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select throws_ok($$select public.roleplay_start('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'boulangerie', 'Allô ?')$$, '42501', null,
  'stacker : ne peut pas créer de session lui-même (seule la fonction serveur le peut)');
select throws_ok($$select public.roleplay_finish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gen_random_uuid(), 100, '{}', 0, 0)$$, '42501', null,
  'stacker : ne peut pas écrire son propre bilan');
select ok(not (public.my_roleplay() ->> 'required')::boolean and not (public.my_roleplay() ->> 'passed')::boolean
          and (public.my_roleplay() -> 'today' ->> 'used')::int = 0 and jsonb_array_length(public.my_roleplay() -> 'history') = 0,
  'my_roleplay : pas exigé par défaut, rien de fait');
reset role;

-- ---------------------------------------------------------------- démarrage
-- (en propriétaire : les droits de service_role sur ces fonctions sont vérifiés par 00_structure)
select throws_ok($$select public.roleplay_start('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'boulangerie', 'Allô ?')$$, '42501', 'onboarding_required',
  'inscription non terminée : pas de session');
select throws_ok($$select public.roleplay_start('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '<x>', 'Allô ?')$$, '22023', 'invalid_request', 'scénario invalide refusé');
insert into t_s values ('a1', (public.roleplay_start('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'boulangerie', 'Boulangerie Martin, bonjour !') ->> 'session_id')::uuid);
select is((public.roleplay_get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a1')) -> 'turns' -> 0 ->> 'text'),
  'Boulangerie Martin, bonjour !', 'session créée : le commerçant décroche');
select throws_ok($$select public.roleplay_get('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', (select id from t_s where k = 'a1'))$$, 'P0002', 'not_found',
  'cloisonnement : B ne peut pas lire la session de A');

-- ---------------------------------------------------------------- répliques
select lives_ok($$select public.roleplay_append('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a1'),
  '  Bonjour, Alice Martin, apporteuse d''affaires indépendante pour Stacker.  ', 'Oui, c''est pour quoi ?', false, 900, 40)$$, 'réplique ajoutée');
select is((select jsonb_array_length(turns) from public.roleplay_sessions where id = (select id from t_s where k = 'a1')), 3,
  '... phrase du stacker et réponse du commerçant enregistrées ensemble');
select is((select turns -> 1 ->> 'text' from public.roleplay_sessions where id = (select id from t_s where k = 'a1')),
  'Bonjour, Alice Martin, apporteuse d''affaires indépendante pour Stacker.', '... espaces retirés');
select is((select tokens_in + tokens_out from public.roleplay_sessions where id = (select id from t_s where k = 'a1')), 940, '... consommation comptée');
select throws_ok($$select public.roleplay_append('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a1'), '   ', 'Ok', false, 0, 0)$$,
  '22023', 'invalid_request', 'phrase vide refusée');
select throws_ok($$select public.roleplay_append('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a1'), repeat('a', 601), 'Ok', false, 0, 0)$$,
  '22023', 'invalid_request', 'phrase trop longue refusée');
select throws_ok($$select public.roleplay_append('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', (select id from t_s where k = 'a1'), 'Salut', 'Ok', false, 0, 0)$$,
  'P0002', 'not_found', 'B ne peut pas écrire dans la session de A');
update public.roleplay_settings set max_turns = 6;
select lives_ok($$select public.roleplay_append('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a1'), 'Deux', 'Ok', false, 0, 0)$$, 'jusqu''à la limite');
select throws_ok($$select public.roleplay_append('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a1'), 'Trois', 'Ok', false, 0, 0)$$,
  '54000', 'too_long', 'au-delà du nombre de répliques : refusé');
update public.roleplay_settings set max_turns = 24;

-- ---------------------------------------------------------------- bilan
select is((public.roleplay_finish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a1'), 95, '{"resume": "Bien"}', 1200, 300) ->> 'passed')::boolean,
  false, 'excellente note mais appel trop court (2 répliques) : pas réussi');
select throws_ok($$select public.roleplay_finish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a1'), 100, '{}', 0, 0)$$,
  '55000', 'session_closed', 'bilan déjà rendu : impossible de le réécrire');
select throws_ok($$select public.roleplay_append('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a1'), 'Encore', 'Ok', false, 0, 0)$$,
  '55000', 'session_closed', 'session terminée : plus de répliques');

insert into t_s values ('a2', (public.roleplay_start('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'garage', 'Garage du Pont !') ->> 'session_id')::uuid);
select public.roleplay_append('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a2'), 'Phrase ' || n, 'Réponse ' || n, false, 10, 10)
from generate_series(1, 5) n;
select throws_ok($$select public.roleplay_finish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a2'), 101, '{}', 0, 0)$$,
  '22023', 'invalid_request', 'note hors bornes refusée');
select is((public.roleplay_finish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a2'), 69, '{}', 0, 0) ->> 'passed')::boolean,
  false, 'note sous le seuil : pas réussi');
insert into t_s values ('a3', (public.roleplay_start('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'garage', 'Garage du Pont !') ->> 'session_id')::uuid);
select public.roleplay_append('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a3'), 'Phrase ' || n, 'Réponse ' || n, false, 10, 10)
from generate_series(1, 5) n;
select is((public.roleplay_finish('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a3'), 70, '{"resume": "Réussi"}', 0, 0) ->> 'passed')::boolean,
  true, 'note au seuil et appel assez long : réussi');

-- Une nouvelle session ferme celle restée ouverte.
insert into t_s values ('a4', (public.roleplay_start('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'hotel', 'Hôtel du Rhône, bonjour.') ->> 'session_id')::uuid);
insert into t_s values ('a5', (public.roleplay_start('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'hotel', 'Hôtel du Rhône, bonjour.') ->> 'session_id')::uuid);
select is((select status from public.roleplay_sessions where id = (select id from t_s where k = 'a4')), 'abandonnee', 'nouvelle session : l''ancienne est abandonnée');

-- Session expirée.
update public.roleplay_sessions set started_at = now() - interval '2 hours' where id = (select id from t_s where k = 'a5');
select throws_ok($$select public.roleplay_get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select id from t_s where k = 'a5'))$$, '55000', 'session_closed',
  'session trop ancienne : fermée');

-- Quota du jour (5 sessions démarrées ; limite abaissée à 5).
update public.roleplay_settings set sessions_per_day = 5;
select throws_ok($$select public.roleplay_start('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'hotel', 'Allô ?')$$, '54000', 'daily_quota', 'quota du jour atteint');
select lives_ok($$select public.roleplay_start('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'hotel', 'Allô ?')$$, '... par stacker : B peut encore s''entraîner');
update public.roleplay_settings set sessions_per_day = 8, monthly_sessions_cap = 6;
select throws_ok($$select public.roleplay_start('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'hotel', 'Allô ?')$$, '54000', 'unavailable', 'plafond mensuel global atteint');
update public.roleplay_settings set monthly_sessions_cap = 3000;
reset role;

-- ---------------------------------------------------------------- lecture par le stacker
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select ok((public.my_roleplay() ->> 'passed')::boolean and (public.my_roleplay() -> 'today' ->> 'used')::int = 5
          and jsonb_array_length(public.my_roleplay() -> 'history') = 5, 'my_roleplay : réussi, quota et historique');
select ok(public.roleplay_detail((select id from t_s where k = 'a3')) ->> 'scenario' = 'garage'
          and jsonb_array_length(public.roleplay_detail((select id from t_s where k = 'a3')) -> 'turns') = 11
          and public.roleplay_detail((select id from t_s where k = 'a3')) -> 'feedback' ->> 'resume' = 'Réussi', 'roleplay_detail : conversation et bilan');
select ok(jsonb_array_length(public.export_my_data() -> 'roleplay_sessions') = 5, 'export RGPD : entraînements inclus');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select throws_ok($$select public.roleplay_detail((select id from t_s where k = 'a3'))$$, 'P0002', 'not_found', 'B ne voit pas le détail de A');
reset role;

-- ---------------------------------------------------------------- signature conditionnée
update public.app_flags set enabled = true where key = 'roleplay_required';
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select ok((public.my_roleplay() ->> 'required')::boolean and not (public.my_roleplay() ->> 'passed')::boolean, 'interrupteur actif : B doit s''entraîner');
select throws_ok($$select public.deal_sign((select j from t_in), (select s from t_sig), public.deal_preview((select j from t_in)) ->> 'contract_sha256')$$,
  '42501', 'training_required', 'B sans simulation réussie : signature refusée');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select lives_ok($$select public.deal_sign((select j from t_in), (select s from t_sig), public.deal_preview((select j from t_in)) ->> 'contract_sha256')$$,
  'A avec une simulation réussie : signature acceptée');
reset role;

-- Interrupteur pilotable par l'admin uniquement.
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select throws_ok($$select public.admin_set_flag('roleplay_required', false)$$, '42501', null, 'stacker : ne peut pas couper l''exigence');
reset role;

select * from finish();
rollback;
