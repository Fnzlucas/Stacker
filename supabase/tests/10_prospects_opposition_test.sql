-- Lot 3 : liste d'opposition (formulaire public, coordonnées), purge RGPD,
-- export des données de prospection et effacement du compte.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(22);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Alice"}');
update public.profiles set onboarding_completed_at = now() where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select public.prospects_cache_put(repeat('d', 64), '{}', 3, '[
  {"siret": "40000000100011", "name": "Fleurs du Rhône"},
  {"siret": "40000000200011", "name": "Boulangerie Sud"},
  {"siret": "40000000300011", "name": "Menuiserie Blanc"}
]'::jsonb);

-- Formulaire public
select throws_ok($$select public.opposition_register_form('12', null)$$, '22023', 'invalid_siren', 'SIREN mal formé ⇒ invalid_siren');
select throws_ok($$select public.opposition_register_form(null, 'pas-un-email')$$, '22023', 'invalid_email', 'email mal formé ⇒ invalid_email');
select throws_ok($$select public.opposition_register_form(null, null)$$, '22023', 'empty', 'formulaire vide ⇒ empty');
select ok(public.opposition_register_form('400 000 001', null), 'formulaire : SIREN avec espaces accepté');
select ok(public.opposition_register_form('400000001', null), '... idempotent');
select is((select count(*)::int from public.opposition_list), 1, '... une seule ligne');
select is((select octet_length(value_hash) from public.opposition_list limit 1), 32, 'valeur hachée (HMAC-SHA256, 32 octets)');
select is((select count(*)::int from public.opposition_list where value_hash = convert_to('400000001', 'UTF8') or value_hash = extensions.digest('400000001', 'sha256')),
          0, 'le SIREN n''est stocké ni en clair ni en simple SHA-256 (poivre secret)');

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select throws_ok($$select public.prospect_claim('40000000100011')$$, 'P0001', 'opposed', 'entreprise opposée ⇒ opposed');
select lives_ok($$select public.prospect_claim('40000000200011')$$, 'autre entreprise : réservable');
reset role;

-- Opposition d'une adresse et d'un domaine
select ok(public.opposition_register_form(null, 'Contact@Menuiserie-Blanc.fr'), 'formulaire : email');
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select throws_ok($$select public.prospect_set_contact((select id from public.prospect_claims where siret = '40000000200011'), null, 'contact@menuiserie-blanc.fr', 'site')$$,
                 'P0001', 'opposed', 'saisir une adresse opposée ⇒ opposed (casse ignorée)');
select lives_ok($$select public.prospect_set_contact((select id from public.prospect_claims where siret = '40000000200011'), '+33490111111', 'bonjour@boulangerie-sud.fr', 'https://boulangerie-sud.fr')$$,
                'saisir des coordonnées non opposées');
-- « Il ne veut plus être contacté » par le stacker : SIREN, email, téléphone, domaine (adresse générique).
select lives_ok($$select public.prospect_release((select id from public.prospect_claims where siret = '40000000200011' and released_at is null), 'opposition')$$,
                'stacker : « il ne veut plus être contacté »');
reset role;
select is((select string_agg(kind, ',' order by kind) from public.opposition_list where source = 'stacker'), 'domain,email,phone,siren',
          '... SIREN, email, téléphone et domaine inscrits');
select ok(public.is_opposed(null, 'autre@boulangerie-sud.fr', null), '... toute adresse du domaine est désormais opposée');
select ok(not public.is_opposed(null, 'quelquun@gmail.com', null), 'un domaine de messagerie grand public n''est jamais opposé en bloc');

-- Export RGPD
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select is(jsonb_array_length(public.export_my_data() -> 'prospects'), 1, 'export_my_data() contient mes prospects');
reset role;

-- Purge à 3 ans
update public.prospect_claims set released_at = now() - interval '3 years 1 day' where siret = '40000000200011';
select lives_ok($$select public.prospect_jobs_purge()$$, 'purge planifiée');
select is((select count(*)::int from public.prospect_claims where siret = '40000000200011'), 0, '... réservations libérées depuis plus de 3 ans effacées');

-- Effacement du compte : réservations, notes, emails et journal partent en cascade.
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select public.prospect_claim('40000000300011');
select public.prospect_add_note((select id from public.prospect_claims where siret = '40000000300011'), 'note');
reset role;
select lives_ok($$delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$, 'suppression du compte (cascade, journal compris)');
select is((select count(*)::int from public.prospect_claims) + (select count(*)::int from public.prospect_events) + (select count(*)::int from public.prospect_notes),
          0, '... plus aucune donnée de prospection du stacker');

select * from finish();
rollback;
