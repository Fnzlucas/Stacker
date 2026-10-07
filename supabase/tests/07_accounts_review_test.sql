-- Revue Lead du lot 2 : tests d'intrusion ajoutés.
--   (a) Un tiers inscrit en premier l'adresse de la victime (non confirmée) :
--       ses choix ne doivent pas devenir ceux de la victime à la confirmation.
--   (b) Effacement RGPD après un changement d'adresse : l'inscription à la
--       liste d'attente rattachée doit disparaître aussi.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(14);

-- ---------------------------------------------------------------- (a) consentements figés par un tiers
-- Le tiers inscrit victime@ avec consentement marketing et un prénom à lui.
insert into auth.users (id, email, raw_user_meta_data)
values ('77777777-7777-4777-8777-777777777777', 'victime@exemple.fr',
        '{"adult_declared": true, "terms_version": "v-old", "marketing_opt_in": true, "first_name": "Pirate"}');
select is(
  (select granted from public.user_consents where user_id = '77777777-7777-4777-8777-777777777777' and purpose = 'marketing_email'),
  true,
  'avant confirmation : le choix du tiers est journalisé (adresse non prouvée)'
);

-- La victime se réinscrit : Supabase Auth remplace les métadonnées de la ligne non confirmée.
update auth.users
set raw_user_meta_data = '{"adult_declared": true, "terms_version": "2026-10-05", "marketing_opt_in": false, "first_name": "Victoire"}'
where id = '77777777-7777-4777-8777-777777777777';
update auth.users set email_confirmed_at = now() where id = '77777777-7777-4777-8777-777777777777';

select is(
  (select granted from public.user_consents
   where user_id = '77777777-7777-4777-8777-777777777777' and purpose = 'marketing_email'
   order by id desc limit 1),
  false,
  'à la confirmation : le consentement marketing en vigueur est celui du titulaire de l''adresse'
);
select is(
  (select document_version from public.user_consents
   where user_id = '77777777-7777-4777-8777-777777777777' and purpose = 'terms_privacy'
   order by id desc limit 1),
  '2026-10-05',
  'à la confirmation : version des CGU acceptée par le titulaire'
);
select is(
  (select source from public.user_consents
   where user_id = '77777777-7777-4777-8777-777777777777' order by id desc limit 1),
  'email_confirmed',
  'les nouvelles lignes sont marquées « email_confirmed » (journal append-only conservé)'
);
select is((select first_name from public.profiles where id = '77777777-7777-4777-8777-777777777777'), 'Victoire', 'prénom du tiers remplacé par celui du titulaire');
select ok(
  (select adult_declared_at >= (select max(created_at) from public.user_consents where user_id = '77777777-7777-4777-8777-777777777777' and source = 'signup')
   from public.profiles where id = '77777777-7777-4777-8777-777777777777'),
  'déclaration de majorité ré-horodatée à la confirmation'
);

-- Métadonnées sans déclaration de majorité au moment de la confirmation : refusée.
insert into auth.users (id, email, raw_user_meta_data)
values ('88888888-8888-4888-8888-888888888888', 'autre@exemple.fr', '{"adult_declared": true, "terms_version": "v1"}');
update auth.users set raw_user_meta_data = '{"terms_version": "v1"}' where id = '88888888-8888-4888-8888-888888888888';
select throws_ok(
  $$update auth.users set email_confirmed_at = now() where id = '88888888-8888-4888-8888-888888888888'$$,
  '22023', 'adult_declaration_required',
  'confirmation refusée si les métadonnées courantes ne déclarent plus la majorité'
);

-- Onboarding déjà fait : la confirmation (cas théorique) ne touche pas au prénom choisi.
insert into auth.users (id, email, raw_user_meta_data)
values ('99999999-9999-4999-8999-999999999990', 'fait@exemple.fr', '{"adult_declared": true, "terms_version": "v1", "first_name": "Avant"}');
update public.profiles set onboarding_completed_at = now(), first_name = 'Choisi' where id = '99999999-9999-4999-8999-999999999990';
update auth.users set email_confirmed_at = now() where id = '99999999-9999-4999-8999-999999999990';
select is((select first_name from public.profiles where id = '99999999-9999-4999-8999-999999999990'), 'Choisi', 'onboarding fait : prénom inchangé à la confirmation');

-- ---------------------------------------------------------------- (b) effacement après changement d'adresse
set local role service_role;
select lives_ok(
  $$select * from public.waitlist_join('ancienne@exemple.fr', 'Léna', '30', true, true, true, 'v1', null, 'DDDDDDDD')$$,
  'ancienne@ sur la liste d''attente'
);
reset role;
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values ('55555555-5555-4555-8555-555555555555', 'ancienne@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1"}');
select is((select launch_priority from public.profiles where id = '55555555-5555-4555-8555-555555555555'), true, 'compte rattaché à la liste d''attente');

-- Changement d'adresse confirmé (Secure email change).
update auth.users set email = 'nouvelle@exemple.fr' where id = '55555555-5555-4555-8555-555555555555';
select is((select count(*)::int from public.waitlist where email = 'ancienne@exemple.fr'), 1, 'l''inscription de l''ancienne adresse existe toujours');

set local role service_role;
select is(public.account_erase_prepare('55555555-5555-4555-8555-555555555555'), true, 'préparation de l''effacement');
reset role;
select is((select count(*)::int from public.waitlist where email = 'ancienne@exemple.fr'), 0, 'inscription rattachée effacée malgré le changement d''adresse');
select is(
  (select count(*)::int from public.consents c where not exists (select 1 from public.waitlist w where w.id = c.waitlist_id)),
  0,
  'aucun consentement orphelin de la liste d''attente'
);

select * from finish();
rollback;
