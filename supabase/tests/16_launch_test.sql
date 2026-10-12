-- Lot 9 : consentements à la souscription (CGV, accès immédiat), emails de
-- confirmation de souscription et de résiliation, progression de formation.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(17);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Alice"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Bob"}');
update public.profiles set onboarding_completed_at = now(), department = '30', last_name = 'Martin';

-- ---------------------------------------------------------------- consentements
set local role service_role;
select throws_ok($$select public.billing_checkout_prepare('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-10-12', false)$$, '22023', 'consent_required', 'sans demande d''accès immédiat : pas de paiement');
select throws_ok($$select public.billing_checkout_prepare('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, true)$$, '22023', 'consent_required', 'sans CGV acceptées : pas de paiement');
select lives_ok($$select public.billing_checkout_prepare('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-10-12', true)$$, 'CGV et accès immédiat acceptés');
reset role;
select ok((select terms_version = '2026-10-12' and terms_accepted_at is not null and immediate_start_at is not null from public.stacker_billing where stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  '... version des CGV et dates enregistrées');

-- ---------------------------------------------------------------- confirmation de souscription
select public.billing_charge_created('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'premier', public.paris_today(), 699, 'tr_a1');
select public.billing_payment_paid('tr_a1', 'mdt_a', 'Carte •••• 4242');
select ok((select (data ->> 'price_cents')::int = 699 and (data ->> 'launch_member')::boolean and data ->> 'terms_version' = '2026-10-12'
           from public.email_outbox where kind = 'abonnement_confirme' and stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'abonnement activé : email de confirmation (prix, offre de lancement, CGV)');
update public.stacker_billing set current_period_end = current_period_end + 30 where stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is((select count(*)::int from public.email_outbox where kind = 'abonnement_confirme'), 1, '... pas à chaque renouvellement');

-- ---------------------------------------------------------------- résiliation
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select public.billing_set_auto_renew(false);
reset role;
select ok((select (data ->> 'access_until')::date = (select current_period_end from public.stacker_billing where stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
           from public.email_outbox where kind = 'abonnement_resilie'), 'résiliation : email de confirmation avec la date de fin d''accès');
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select public.billing_set_auto_renew(true);
reset role;
select is((select count(*)::int from public.email_outbox where kind in ('abonnement_resilie', 'abonnement_confirme')), 2, 'reprise de l''abonnement : pas de nouvel email');

-- ---------------------------------------------------------------- formation
set local role anon;
select throws_ok($$select public.my_formation()$$, '42501', null, 'anon : formation refusée');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select is(public.my_formation(), '[]'::jsonb, 'formation : rien de fait au départ');
select is(public.formation_set_done('bases', true), '["bases"]'::jsonb, 'module terminé');
select is(public.formation_set_done('bases', true), '["bases"]'::jsonb, '... une seule fois');
select is(public.formation_set_done('appel', true), '["bases", "appel"]'::jsonb, 'deuxième module');
select is(public.formation_set_done('bases', false), '["appel"]'::jsonb, 'module décoché');
select throws_ok($$select public.formation_set_done('<script>', true)$$, '22023', 'invalid_request', 'identifiant de module invalide refusé');
select ok(public.export_my_data() -> 'formation' -> 0 ->> 'module' = 'appel' and public.export_my_data() -> 'subscription_consents' ->> 'terms_version' = '2026-10-12',
  'export RGPD : formation et consentements');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select is(public.my_formation(), '[]'::jsonb, 'B ne voit pas la progression de A');
reset role;

select * from finish();
rollback;
