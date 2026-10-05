-- Lot 2 : création du profil à l'inscription, déclaration de majorité,
-- consentements, rattachement à la liste d'attente, niveaux calculés serveur.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(30);

-- Une inscription liste d'attente existante (chemin officiel).
set local role service_role;
select lives_ok(
  $$select * from public.waitlist_join('ines@exemple.fr', 'Inès', '84', true, true, true, 'v1', null, 'AAAAAAAA')$$,
  'service_role inscrit ines@ sur la liste d''attente'
);
reset role;

-- ---------------------------------------------------------------- déclaration obligatoire
select throws_ok(
  $$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-4000-8000-0000000000f1', 'mineur@exemple.fr', '{"terms_version": "v1"}')$$,
  '22023', 'adult_declaration_required',
  'inscription refusée sans déclaration de majorité'
);
select throws_ok(
  $$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-4000-8000-0000000000f2', 'faux@exemple.fr', '{"adult_declared": "oui", "terms_version": "v1"}')$$,
  '22023', 'adult_declaration_required',
  'inscription refusée si la déclaration n''est pas exactement true'
);
select throws_ok(
  $$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-4000-8000-0000000000f3', 'cgu@exemple.fr', '{"adult_declared": true}')$$,
  '22023', 'terms_not_accepted',
  'inscription refusée sans acceptation versionnée des CGU'
);
select throws_ok(
  $$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-4000-8000-0000000000f4', 'nometa@exemple.fr', null)$$,
  '22023', 'adult_declaration_required',
  'inscription refusée sans aucune métadonnée'
);
select is((select count(*)::int from auth.users where id::text like '00000000-0000-4000-8000-0000000000f%'), 0, 'aucun compte créé par les tentatives refusées');

-- ---------------------------------------------------------------- inscription normale (non confirmée)
insert into auth.users (id, email, raw_user_meta_data)
values ('11111111-1111-4111-8111-111111111111', 'ines@exemple.fr',
        '{"adult_declared": true, "terms_version": "2026-10-05", "marketing_opt_in": false, "first_name": "  Inès  "}');

select is((select count(*)::int from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 1, 'profil créé par le trigger');
select is((select first_name from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 'Inès', 'prénom des métadonnées, nettoyé');
select is((select tier from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 'rookie', 'niveau initial : rookie');
select is((select xp from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 0, 'XP initial : 0');
select ok((select adult_declared_at is not null and adult_declared_at <= now() from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 'déclaration de majorité horodatée');
select is(
  (select array_agg(purpose || '=' || granted::text || '@' || document_version order by purpose) from public.user_consents where user_id = '11111111-1111-4111-8111-111111111111'),
  array['marketing_email=false@2026-10-05', 'terms_privacy=true@2026-10-05'],
  'consentements séparés, versionnés ; marketing facultatif et refusé'
);
select is(
  (select launch_priority from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  false,
  'adresse non confirmée : aucune priorité de liste d''attente rattachée'
);

-- ---------------------------------------------------------------- confirmation de l'adresse
update auth.users set email_confirmed_at = now() where id = '11111111-1111-4111-8111-111111111111';
select is((select launch_priority from public.profiles where id = '11111111-1111-4111-8111-111111111111'), true, 'confirmation : priorité de lancement conservée');
select is(
  (select p.waitlist_id = w.id and p.waitlist_joined_at = w.created_at
   from public.profiles p, public.waitlist w
   where p.id = '11111111-1111-4111-8111-111111111111' and w.email = 'ines@exemple.fr'),
  true,
  'profil rattaché à la bonne inscription, date d''inscription conservée'
);
select is((select department from public.profiles where id = '11111111-1111-4111-8111-111111111111'), '84', 'département repris de la liste d''attente');

-- Compte déjà confirmé à la création (ex. invitation admin) : rattachement immédiat.
set local role service_role;
select lives_ok(
  $$select * from public.waitlist_join('karim@exemple.fr', 'Karim', '13', true, true, false, 'v1', null, 'BBBBBBBB')$$,
  'karim@ sur la liste d''attente'
);
reset role;
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values ('22222222-2222-4222-8222-222222222222', 'karim@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "marketing_opt_in": true}');
select is((select launch_priority from public.profiles where id = '22222222-2222-4222-8222-222222222222'), true, 'compte confirmé dès la création : priorité rattachée');
select is((select first_name from public.profiles where id = '22222222-2222-4222-8222-222222222222'), 'Karim', 'prénom absent des métadonnées : repris de la liste d''attente');
select is(
  (select granted from public.user_consents where user_id = '22222222-2222-4222-8222-222222222222' and purpose = 'marketing_email'),
  true,
  'consentement marketing accordé enregistré'
);

-- Compte sans inscription préalable.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values ('33333333-3333-4333-8333-333333333333', 'nouveau@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1"}');
select is((select launch_priority from public.profiles where id = '33333333-3333-4333-8333-333333333333'), false, 'pas sur la liste d''attente : aucune priorité');

-- ---------------------------------------------------------------- journal append-only
select throws_ok($$update public.user_consents set granted = true where user_id = '11111111-1111-4111-8111-111111111111'$$, '42501', 'user_consents_append_only', 'user_consents : UPDATE interdit, même au propriétaire');
select throws_ok($$delete from public.user_consents where user_id = '11111111-1111-4111-8111-111111111111'$$, '42501', 'user_consents_append_only', 'user_consents : DELETE interdit tant que le compte existe');

-- ---------------------------------------------------------------- niveaux calculés serveur
update public.profiles set active_clients = 3 where id = '22222222-2222-4222-8222-222222222222';
select is((select tier from public.profiles where id = '22222222-2222-4222-8222-222222222222'), 'pro', '3 clients actifs : Pro (seuil provisoire)');
update public.profiles set active_clients = 25 where id = '22222222-2222-4222-8222-222222222222';
select is((select tier from public.profiles where id = '22222222-2222-4222-8222-222222222222'), 'elite', '25 clients actifs : Elite');
update public.profiles set tier = 'elite', active_clients = 0 where id = '33333333-3333-4333-8333-333333333333';
select is((select tier from public.profiles where id = '33333333-3333-4333-8333-333333333333'), 'rookie', 'même le serveur ne pose pas un niveau à la main : il est dérivé des clients actifs');
update public.commission_tiers set min_active_clients = 30, max_active_clients = null where code = 'elite';
select is((select tier from public.profiles where id = '22222222-2222-4222-8222-222222222222'), 'legend', 'changement de seuil : niveaux recalculés');
select is((select bool_and(criteria_provisional) from public.commission_tiers), true, 'critères marqués provisoires');

-- ---------------------------------------------------------------- suppression du compte : cascade
delete from auth.users where id = '22222222-2222-4222-8222-222222222222';
select is((select count(*)::int from public.profiles where id = '22222222-2222-4222-8222-222222222222'), 0, 'suppression du compte : profil effacé (cascade)');
select is((select count(*)::int from public.user_consents where user_id = '22222222-2222-4222-8222-222222222222'), 0, 'suppression du compte : consentements effacés (cascade)');

select * from finish();
rollback;
