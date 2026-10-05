-- Tests d'intrusion : anon et authenticated ne lisent ni n'écrivent rien,
-- même si un GRANT était ajouté par erreur (RLS forcée sans politique).
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(27);

-- Une inscription réelle, faite par le seul chemin autorisé.
set local role service_role;
select lives_ok(
  $$select * from public.waitlist_join('alice@exemple.fr', 'Alice', '84', true, true, false, 'test', null, 'AAAAAAAA')$$,
  'service_role inscrit via waitlist_join()'
);
reset role;

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select * from public.waitlist$$, '42501', null, 'anon : SELECT waitlist refusé');
select throws_ok($$select email from public.waitlist where email = 'alice@exemple.fr'$$, '42501', null, 'anon : lecture ciblée d''un email refusée');
select throws_ok($$insert into public.waitlist (email, first_name, referral_code, age_confirmed) values ('x@exemple.fr', 'X', 'BBBBBBBB', true)$$, '42501', null, 'anon : INSERT waitlist refusé');
select throws_ok($$update public.waitlist set first_name = 'Pirate'$$, '42501', null, 'anon : UPDATE waitlist refusé');
select throws_ok($$delete from public.waitlist$$, '42501', null, 'anon : DELETE waitlist refusé');
select throws_ok($$select * from public.consents$$, '42501', null, 'anon : SELECT consents refusé');
select throws_ok($$insert into public.consents (waitlist_id, purpose, granted, document_version) values (gen_random_uuid(), 'marketing_email', true, 'x')$$, '42501', null, 'anon : INSERT consents refusé');
select throws_ok($$select * from public.rate_limits$$, '42501', null, 'anon : SELECT rate_limits refusé');
select throws_ok($$delete from public.rate_limits$$, '42501', null, 'anon : DELETE rate_limits refusé');
select throws_ok($$select * from public.waitlist_join('bob@exemple.fr', 'Bob', null, true, true, false, 'test', null, 'CCCCCCCC')$$, '42501', null, 'anon : waitlist_join() refusé');
select throws_ok($$select public.rate_limit_hit('x', 1, 60)$$, '42501', null, 'anon : rate_limit_hit() refusé');
select throws_ok($$select public.waitlist_erase('alice@exemple.fr')$$, '42501', null, 'anon : waitlist_erase() refusé');
select is(public.waitlist_count(), 1, 'anon : waitlist_count() renvoie le nombre exact d''inscrits');
reset role;

-- ---------------------------------------------------------------- authenticated
set local role authenticated;
set local request.jwt.claims = '{"sub": "8d0f6a0e-2f7a-4c55-9f42-6f2b8f0c1a11", "role": "authenticated"}';
select throws_ok($$select * from public.waitlist$$, '42501', null, 'authenticated : SELECT waitlist refusé');
select throws_ok($$insert into public.waitlist (email, first_name, referral_code, age_confirmed) values ('y@exemple.fr', 'Y', 'DDDDDDDD', true)$$, '42501', null, 'authenticated : INSERT waitlist refusé');
select throws_ok($$update public.waitlist set first_name = 'Pirate'$$, '42501', null, 'authenticated : UPDATE waitlist refusé');
select throws_ok($$delete from public.waitlist$$, '42501', null, 'authenticated : DELETE waitlist refusé');
select throws_ok($$select * from public.consents$$, '42501', null, 'authenticated : SELECT consents refusé');
select throws_ok($$select * from public.waitlist_join('carl@exemple.fr', 'Carl', null, true, true, false, 'test', null, 'EEEEEEEE')$$, '42501', null, 'authenticated : waitlist_join() refusé');
select is(public.waitlist_count(), 1, 'authenticated : waitlist_count() autorisé');
reset role;

-- ---------------------------------------------------------------- défense en profondeur
-- Simule une erreur humaine : un GRANT accordé à anon. La RLS forcée, sans
-- aucune politique pour anon, doit encore tout bloquer.
grant select, update, delete on public.waitlist to anon;
grant select on public.consents to anon;
set local role anon;
select is((select count(*)::int from public.waitlist), 0, 'GRANT accidentel : anon ne voit toujours aucune ligne de waitlist');
select is((select count(*)::int from public.consents), 0, 'GRANT accidentel : anon ne voit toujours aucun consentement');
select lives_ok($$update public.waitlist set first_name = 'Pirate'$$, 'GRANT accidentel : UPDATE exécuté...');
select lives_ok($$delete from public.waitlist$$, 'GRANT accidentel : DELETE exécuté...');
reset role;
select is((select first_name from public.waitlist where email = 'alice@exemple.fr'), 'Alice', '... mais aucune ligne n''a été modifiée');
select is((select count(*)::int from public.waitlist), 1, '... ni supprimée');

select * from finish();
rollback;
