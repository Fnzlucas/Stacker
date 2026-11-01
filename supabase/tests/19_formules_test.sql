-- Trois formules : prix, accès Pro / Academy, appel d'habilitation pour les
-- stackers Pro, changement de formule au renouvellement, prix du paiement.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(22);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Alice"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Bob"}'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'chloe@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Chloé"}');
update public.profiles set onboarding_completed_at = now(), department = '30', last_name = 'Martin', ai_consent_at = now();
update public.app_flags set enabled = true where key = 'billing_required';

select is(public.billing_plan_price('academy'), 1299, 'Academy : 12,99 €');
select is(public.billing_plan_price('pro'), 999, 'Pro : 9,99 €');
select is(public.billing_plan_price('duo'), 1499, 'Academy + Pro : 14,99 €');

-- Sans abonnement : ni Pro ni Academy.
select ok(not public.stacker_has_access('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') and not public.stacker_has_academy('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'sans abonnement : aucun accès');
select throws_ok($$select public.roleplay_start('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'boulangerie', 'Allô ?')$$, 'P0001', 'academy_required',
  'sans Academy : pas d''entraînement');

-- Paiement : le montant suit la formule choisie.
select throws_ok($$select public.billing_checkout_prepare('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-11-01', true, 'gold')$$, '22023', 'invalid_plan',
  'formule inconnue refusée');
select is((public.billing_checkout_prepare('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-11-01', true, 'academy') ->> 'amount_cents')::int, 1299,
  'Academy : premier paiement de 12,99 €');
select is((public.billing_checkout_prepare('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-11-01', true, 'pro') ->> 'amount_cents')::int, 999,
  'Pro : premier paiement de 9,99 €');
select is((public.billing_checkout_prepare('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '2026-11-01', true, 'duo') ->> 'amount_cents')::int, 1499,
  'Academy + Pro : premier paiement de 14,99 €');
select public.billing_charge_created(x.id, 'premier', public.paris_today(), public.billing_plan_price(b.plan), 'tr_' || left(x.id::text, 1))
from public.profiles x join public.stacker_billing b on b.stacker_id = x.id;
select public.billing_payment_paid('tr_a', 'mdt_a', 'Carte'), public.billing_payment_paid('tr_b', 'mdt_b', 'Carte'), public.billing_payment_paid('tr_c', 'mdt_c', 'Carte');

-- Accès selon la formule.
select ok(public.stacker_has_academy('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') and not public.stacker_has_access('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'Academy : entraînement oui, prospection non');
select throws_ok($$select public.prospects_search_begin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$, 'P0001', 'subscription_required',
  'Academy seule : recherche d''entreprises refusée');
select lives_ok($$select public.roleplay_start('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'boulangerie', 'Allô ?')$$, 'Academy : entraînement ouvert');
select ok(public.stacker_has_access('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') and not public.stacker_has_academy('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'Pro : prospection oui, Academy non');
select throws_ok($$select public.roleplay_start('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'boulangerie', 'Allô ?')$$, 'P0001', 'academy_required',
  'Pro sans Academy : pas d''entraînement libre');
update public.app_flags set enabled = true where key = 'roleplay_required';
select lives_ok($$select public.roleplay_start('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'boulangerie', 'Allô ?')$$,
  'Pro : l''appel d''habilitation exigé avant la première signature reste ouvert');
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select ok((public.my_roleplay() ->> 'qualification')::boolean and not (public.my_roleplay() ->> 'academy')::boolean,
  'my_roleplay : Pro en habilitation, sans Academy');
reset role;
update public.app_flags set enabled = false where key = 'roleplay_required';
select ok(public.stacker_has_access('cccccccc-cccc-4ccc-8ccc-cccccccccccc') and public.stacker_has_academy('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  'Academy + Pro : tout');

-- Changement de formule : au prochain renouvellement, au prix de la nouvelle formule.
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select throws_ok($$select public.billing_set_plan('gold')$$, '22023', 'invalid_plan', 'formule inconnue refusée');
select is(public.billing_set_plan('duo') ->> 'pending_plan', 'duo', 'Pro → Academy + Pro : prévu au renouvellement');
select is(public.my_billing() ->> 'plan', 'pro', '... formule actuelle inchangée d''ici là');
reset role;
-- Un mois plus tard : la période payée se termine aujourd'hui.
update public.billing_charges set period_start = (public.paris_today() - interval '1 month')::date where stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
update public.stacker_billing set current_period_end = public.paris_today(), mollie_customer_id = 'cst_b' where stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
create temporary table t_renew on commit drop as select public.billing_renew_due(10) as j;
select is((select (x ->> 'amount_cents')::int from jsonb_array_elements((select j from t_renew)) x where x ->> 'stacker_id' = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1499,
  'renouvellement au prix de la nouvelle formule');
select ok((select plan = 'duo' and pending_plan is null from public.stacker_billing where stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  '... et formule appliquée');

select * from finish();
rollback;
