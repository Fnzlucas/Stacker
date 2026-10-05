-- Lot 2 : effacement du compte (RGPD). account_erase_prepare() efface
-- l'inscription à la liste d'attente rattachée ; la suppression de
-- l'utilisateur (API admin Auth) emporte le reste par cascade.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(11);

set local role service_role;
select lives_ok(
  $$select * from public.waitlist_join('lea@exemple.fr', 'Léa', '30', true, true, true, 'v1', null, 'CCCCCCCC')$$,
  'léa@ sur la liste d''attente'
);
reset role;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values ('44444444-4444-4444-8444-444444444444', 'lea@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1"}');
select is((select launch_priority from public.profiles where id = '44444444-4444-4444-8444-444444444444'), true, 'compte rattaché à la liste d''attente');

set local role service_role;
select is(public.account_erase_prepare('44444444-4444-4444-8444-444444444444'), true, 'service_role : préparation de l''effacement');
select is(public.account_erase_prepare('99999999-9999-4999-8999-999999999999'), false, 'utilisateur inconnu : false, sans erreur (idempotent)');
select throws_ok($$select public.account_erase_prepare(null)$$, '22023', 'invalid_user', 'identifiant nul refusé');
reset role;

select is((select count(*)::int from public.waitlist where email = 'lea@exemple.fr'), 0, 'inscription liste d''attente effacée');
select is((select count(*)::int from public.consents c where not exists (select 1 from public.waitlist w where w.id = c.waitlist_id)), 0, 'consentements de la liste d''attente effacés avec elle');
select is((select waitlist_id from public.profiles where id = '44444444-4444-4444-8444-444444444444'), null, 'lien du profil remis à null');
select is((select launch_priority from public.profiles where id = '44444444-4444-4444-8444-444444444444'), true, 'priorité de lancement inchangée jusqu''à la suppression du compte');

-- Étape 2 (API admin Auth) : suppression de l'utilisateur.
delete from auth.users where id = '44444444-4444-4444-8444-444444444444';
select is((select count(*)::int from public.profiles where id = '44444444-4444-4444-8444-444444444444'), 0, 'profil effacé');
select is((select count(*)::int from public.user_consents where user_id = '44444444-4444-4444-8444-444444444444'), 0, 'consentements du compte effacés');

select * from finish();
rollback;
