-- waitlist_join() : inscription, idempotence, parrainage, validations,
-- journal de consentements append-only et effacement RGPD.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(30);

set local role service_role;

create temp table j1 as
  select * from public.waitlist_join('alice@exemple.fr', 'Alice', '84', true, true, false, '2026-10-05', null, 'AAAAAAAA');
select is((select queue_position from j1), 1::bigint, 'première inscription : position 1');
select is((select code from j1), 'AAAAAAAA', 'première inscription : code de parrainage renvoyé');
select is((select created from j1), true, 'première inscription : created = true');

-- Réinscription du même email, avec d'autres valeurs : rien ne change.
create temp table j1b as
  select * from public.waitlist_join('alice@exemple.fr', 'Mallory', '13', true, true, true, '2026-10-05', null, 'ZZZZZZZZ');
select is((select queue_position from j1b), 1::bigint, 'réinscription : même position');
select is((select code from j1b), 'AAAAAAAA', 'réinscription : même code (le nouveau code est ignoré)');
select is((select created from j1b), false, 'réinscription : created = false');

-- Parrainage : code en minuscules et avec espaces, normalisé.
create temp table j2 as
  select * from public.waitlist_join('bob@exemple.fr', 'Bob', null, true, true, true, '2026-10-05', '  aaaaaaaa ', 'BBBBBBBB');
select is((select queue_position from j2), 2::bigint, 'deuxième inscription : position 2');

-- Code de parrainage inconnu : ignoré, l'inscription passe.
create temp table j3 as
  select * from public.waitlist_join('carla@exemple.fr', 'Carla', '', true, true, false, '2026-10-05', 'QQQQQQQQ', 'CCCCCCCC');
select is((select queue_position from j3), 3::bigint, 'parrain inconnu : inscription acceptée, position 3');

select throws_ok(
  $$select * from public.waitlist_join('dan@exemple.fr', 'Dan', null, true, true, false, '2026-10-05', null, 'AAAAAAAA')$$,
  'P0001', 'referral_code_collision', 'collision de code de parrainage : erreur dédiée (l''Edge Function réessaie)');
select throws_ok(
  $$select * from public.waitlist_join('Eve@Exemple.fr', 'Eve', null, true, true, false, '2026-10-05', null, 'EEEEEEEE')$$,
  '23514', null, 'email non normalisé (majuscules) refusé par la base');
select throws_ok(
  $$select * from public.waitlist_join('pas-un-email', 'Eve', null, true, true, false, '2026-10-05', null, 'EEEEEEEE')$$,
  '23514', null, 'email sans @ refusé par la base');
select throws_ok(
  $$select * from public.waitlist_join('eve@exemple.fr', 'Eve', null, false, true, false, '2026-10-05', null, 'EEEEEEEE')$$,
  '22023', 'age_not_confirmed', 'majorité non déclarée : refus');
select throws_ok(
  $$select * from public.waitlist_join('eve@exemple.fr', 'Eve', null, true, false, false, '2026-10-05', null, 'EEEEEEEE')$$,
  '22023', 'terms_not_accepted', 'CGU non acceptées : refus');
select throws_ok(
  $$select * from public.waitlist_join('eve@exemple.fr', 'Eve', '20', true, true, false, '2026-10-05', null, 'EEEEEEEE')$$,
  '23514', null, 'département inexistant (20) refusé');
select throws_ok(
  $$select * from public.waitlist_join('eve@exemple.fr', repeat('a', 51), null, true, true, false, '2026-10-05', null, 'EEEEEEEE')$$,
  '23514', null, 'prénom de plus de 50 caractères refusé');
select throws_ok(
  $$select * from public.waitlist_join('eve@exemple.fr', 'Eve', null, true, true, false, '2026-10-05', null, 'eeeeeeee')$$,
  '23514', null, 'code de parrainage généré hors alphabet refusé');
select is(public.waitlist_count(), 3, 'les tentatives refusées n''ont rien inséré');

reset role;

-- Vérifications en lecture (superutilisateur de test).
select is((select count(*)::int from public.waitlist where email = 'alice@exemple.fr'), 1, 'idempotence : une seule ligne pour alice');
select is((select first_name from public.waitlist where email = 'alice@exemple.fr'), 'Alice', 'idempotence : prénom non écrasé par la réinscription');
select is((select count(*)::int from public.consents c join public.waitlist w on w.id = c.waitlist_id where w.email = 'alice@exemple.fr'), 2,
  'idempotence : 2 consentements pour alice, pas de doublon');
select is((select granted from public.consents c join public.waitlist w on w.id = c.waitlist_id where w.email = 'alice@exemple.fr' and c.purpose = 'marketing_email'), false,
  'consentement marketing refusé enregistré (et non modifié par la réinscription)');
select is((select granted from public.consents c join public.waitlist w on w.id = c.waitlist_id where w.email = 'bob@exemple.fr' and c.purpose = 'marketing_email'), true,
  'consentement marketing accordé enregistré séparément');
select is((select r.email from public.waitlist b join public.waitlist r on r.id = b.referred_by where b.email = 'bob@exemple.fr'), 'alice@exemple.fr',
  'parrainage : bob est rattaché à alice');
select is((select referred_by from public.waitlist where email = 'carla@exemple.fr'), null::uuid, 'parrain inconnu : referred_by reste vide');
select is((select department from public.waitlist where email = 'carla@exemple.fr'), null::text, 'département vide stocké comme NULL');

-- Journal append-only, même pour un administrateur.
select throws_ok($$update public.consents set granted = true$$, '42501', 'consents_append_only', 'consents : UPDATE interdit');
select throws_ok($$delete from public.consents$$, '42501', 'consents_append_only', 'consents : DELETE interdit');
select throws_ok($$truncate public.consents cascade$$, '42501', 'consents_append_only', 'consents : TRUNCATE interdit');

-- Effacement RGPD : seule exception au journal append-only.
set local role service_role;
select is(public.waitlist_erase('  BOB@exemple.fr '), true, 'waitlist_erase() supprime l''inscription demandée');
reset role;
select is(
  (select count(*)::int from public.consents c where not exists (select 1 from public.waitlist w where w.id = c.waitlist_id))
  + (select count(*)::int from public.waitlist where email = 'bob@exemple.fr'),
  0,
  'effacement : inscription et consentements supprimés, aucune ligne orpheline'
);

select * from finish();
rollback;
