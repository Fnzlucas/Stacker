-- Lot 2 : tests d'intrusion sur les comptes. A tente de lire et de modifier
-- le profil de B, de s'auto-promouvoir, de s'attribuer de l'XP, de créer ou
-- supprimer des profils ; anon tente tout.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(45);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Alice"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Bob"}');
update public.profiles set active_clients = 12, xp = 340, phone = '+33612345678' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select * from public.profiles$$, '42501', null, 'anon : SELECT profiles refusé');
select throws_ok($$select * from public.commission_tiers$$, '42501', null, 'anon : SELECT commission_tiers refusé');
select throws_ok($$select * from public.user_consents$$, '42501', null, 'anon : SELECT user_consents refusé');
select throws_ok($$update public.profiles set first_name = 'Pirate'$$, '42501', null, 'anon : UPDATE profiles refusé');
select throws_ok($$insert into public.profiles (id, adult_declared_at) values (gen_random_uuid(), now())$$, '42501', null, 'anon : INSERT profiles refusé');
select throws_ok($$delete from public.profiles$$, '42501', null, 'anon : DELETE profiles refusé');
select throws_ok($$select public.complete_onboarding('X', '84', 'complement')$$, '42501', null, 'anon : complete_onboarding() refusé');
select throws_ok($$select public.export_my_data()$$, '42501', null, 'anon : export_my_data() refusé');
select throws_ok($$select public.account_erase_prepare('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$, '42501', null, 'anon : account_erase_prepare() refusé');
reset role;

-- ---------------------------------------------------------------- A connecté
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

-- Lecture
select is((select count(*)::int from public.profiles), 1, 'A ne voit qu''une seule ligne de profiles');
select is((select id from public.profiles), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '... la sienne');
select is((select count(*)::int from public.profiles where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0, 'A : lecture ciblée du profil de B → 0 ligne');
select is((select count(*)::int from public.profiles where phone = '+33612345678'), 0, 'A : recherche par téléphone de B → 0 ligne');
select is((select count(*)::int from public.commission_tiers), 4, 'A lit les 4 paliers');
select throws_ok($$select * from public.user_consents$$, '42501', null, 'A : SELECT user_consents refusé (export uniquement)');
select throws_ok($$select * from public.waitlist$$, '42501', null, 'A : SELECT waitlist toujours refusé');

-- Écriture sur B
select lives_ok($$update public.profiles set first_name = 'Pirate' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, 'A : UPDATE du profil de B exécuté...');
select throws_ok($$delete from public.profiles where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, '42501', null, 'A : DELETE du profil de B refusé');
select throws_ok($$insert into public.profiles (id, adult_declared_at) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', now())$$, '42501', null, 'A : INSERT d''un profil refusé');
select throws_ok($$update public.profiles set id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, '42501', null, 'A : changer son id refusé');

-- Auto-promotion et champs serveur
select throws_ok($$update public.profiles set tier = 'elite'$$, '42501', null, 'A : s''auto-promouvoir Elite refusé');
select throws_ok($$update public.profiles set active_clients = 100$$, '42501', null, 'A : gonfler ses clients actifs refusé');
select throws_ok($$update public.profiles set xp = 999999$$, '42501', null, 'A : s''attribuer de l''XP refusé');
select throws_ok($$update public.profiles set launch_priority = true$$, '42501', null, 'A : s''attribuer la priorité de lancement refusé');
select throws_ok($$update public.profiles set adult_declared_at = null$$, '42501', null, 'A : modifier la déclaration de majorité refusé');
select throws_ok($$update public.profiles set onboarding_completed_at = now()$$, '42501', null, 'A : marquer l''onboarding fait sans le serveur refusé');
select throws_ok($$update public.profiles set created_at = now()$$, '42501', null, 'A : modifier created_at refusé');
select throws_ok($$update public.commission_tiers set rate_bps = 9000$$, '42501', null, 'A : modifier un taux de commission refusé');
select throws_ok($$insert into public.user_consents (user_id, purpose, granted, document_version) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'marketing_email', true, 'x')$$, '42501', null, 'A : écrire un consentement en direct refusé');

-- Champs autorisés sur son propre profil
select lives_ok($$update public.profiles set first_name = 'Alice', last_name = 'Martin', phone = '+33698765432', department = '2A', city = 'Ajaccio', legal_status = 'micro_entrepreneur', siret = '73282932000074', goal = 'complement'$$, 'A : modifie ses champs déclaratifs');
select throws_ok($$update public.profiles set siret = '12345678901234'$$, '23514', null, 'A : SIRET à clé invalide refusé par la base');
select throws_ok($$update public.profiles set legal_status = 'sans_statut'$$, '23514', null, 'A : SIRET sans statut d''entreprise refusé');
select throws_ok($$update public.profiles set phone = '0612345678'$$, '23514', null, 'A : téléphone hors format E.164 refusé');
select throws_ok($$update public.profiles set department = '20'$$, '23514', null, 'A : département inexistant refusé');

-- RPC
select lives_ok($$select public.complete_onboarding('  Alice ', '84', 'decouvrir')$$, 'A : complete_onboarding() sur son profil');
select throws_ok($$select public.complete_onboarding('', '84', 'decouvrir')$$, '22023', 'invalid_first_name', 'A : complete_onboarding() sans prénom refusé');
select throws_ok($$select public.complete_onboarding('Alice', '84', 'devenir_riche')$$, '23514', null, 'A : objectif hors liste refusé');
select is((select (public.export_my_data() -> 'profile' ->> 'id')), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A : export_my_data() renvoie SON profil');
select is((select (public.export_my_data() -> 'account' ->> 'email')), 'alice@exemple.fr', 'A : export contient SON email');
select is((select jsonb_array_length(public.export_my_data() -> 'consents')), 2, 'A : export contient SES 2 consentements');
select throws_ok($$select public.account_erase_prepare('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$, '42501', null, 'A : account_erase_prepare() refusé (service_role seulement)');
reset role;

-- ---------------------------------------------------------------- vérifications par le propriétaire
select is((select first_name from public.profiles where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'Bob', 'le profil de B est intact (UPDATE de A sans effet)');
select is(
  (select tier || '/' || xp::text || '/' || active_clients::text from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'rookie/0/0',
  'les champs serveur de A sont intacts'
);
select ok(
  (select onboarding_completed_at is not null and first_name = 'Alice' and goal = 'decouvrir' from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'onboarding horodaté par le serveur'
);

-- ---------------------------------------------------------------- défense en profondeur
-- Erreur humaine simulée : un GRANT UPDATE complet accordé à authenticated.
-- Le trigger de garde bloque toujours l'auto-promotion.
grant update on public.profiles to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select throws_ok($$update public.profiles set tier = 'elite', xp = 10 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$, '42501', 'profiles_server_field', 'GRANT accidentel : l''auto-promotion reste bloquée par le trigger');
reset role;

select * from finish();
rollback;
