-- Formule gratuite (signature et commissions sans abonnement, prospection
-- réservée à Pro) et offres gros ticket à paiement unique.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(29);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Alice"}');
update public.profiles set onboarding_completed_at = now(), department = '30', last_name = 'Martin', ai_consent_at = now();
update public.app_flags set enabled = true where key in ('billing_required', 'roleplay_required');

create temporary table t_in (j jsonb) on commit drop;
insert into t_in values ('{"offer_id": "studio-site-vitrine", "quantity": 1, "siret": "73282932000074", "company_name": "Boulangerie Test",
  "company_address": "1 rue de la Paix, 30000 Nîmes", "first_name": "Jean", "last_name": "Dupont", "role": "Gérant",
  "email": "contact@boulangerie-test.fr", "phone": "+33612345678", "iban_holder": "Boulangerie Test",
  "iban": "FR7630006000011234567890189", "accept_terms": true, "accept_mandate": true}');
grant select on t_in to authenticated, service_role;
create temporary table t_sig (s text) on commit drop;
insert into t_sig values ('data:image/png;base64,' || repeat('iVBORw0KGgo', 300));
grant select on t_sig to authenticated, service_role;
create temporary table t_deal (id uuid) on commit drop;
grant all on t_deal to authenticated, service_role;

-- ---------------------------------------------------------------- formule gratuite
select ok(not public.stacker_has_access('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') and not public.stacker_has_academy('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'gratuit : ni Pro ni Academy');
select throws_ok($$select public.prospects_search_begin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$, 'P0001', 'subscription_required',
  'gratuit : recherche d''entreprises réservée à Pro');
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select throws_ok($$select public.prospect_claim('73282932000074')$$, 'P0001', 'subscription_required', 'gratuit : réservation de prospect réservée à Pro');
select throws_ok($$select public.campaign_start('30', 'batiment', 20, 'decouverte')$$, 'P0001', 'subscription_required', 'gratuit : campagnes réservées à Pro');
select ok((public.my_roleplay() ->> 'qualification')::boolean, 'gratuit : appel d''habilitation à faire avant la première signature');
select lives_ok($$select public.deal_preview((select j from t_in))$$, 'gratuit : aperçu du contrat ouvert');
select throws_ok($$select public.deal_sign((select j from t_in), (select s from t_sig), public.deal_preview((select j from t_in)) ->> 'contract_sha256')$$,
  '42501', 'training_required', 'gratuit : signature après l''appel d''habilitation');
reset role;
select lives_ok($$select public.roleplay_start('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'boulangerie', 'Allô ?')$$,
  'gratuit : l''appel d''habilitation est ouvert sans Academy');
update public.roleplay_sessions set status = 'terminee', score = 80, passed = true, ended_at = now();
select throws_ok($$select public.roleplay_start('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'boulangerie', 'Allô ?')$$, 'P0001', 'academy_required',
  'habilitation réussie : l''entraînement libre reste réservé à Academy');

-- ---------------------------------------------------------------- gros ticket
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select is((select count(*)::int from jsonb_array_elements(public.deal_catalog() -> 'offers') o where o ->> 'billing' = 'unique'), 9,
  'catalogue : 9 offres sur mesure à paiement unique');
select is(public.deal_catalog() -> 'offers' -> 0 ->> 'id', 'studio-site-vitrine', '... en tête du catalogue');
select is(public.deal_preview((select j from t_in)) ->> 'billing', 'unique', 'aperçu : paiement unique');
select is((public.deal_preview((select j from t_in)) ->> 'commission_cents')::int, 22350, '... commission : 15 % de 1 490 €, soit 223,50 €');
select ok(public.deal_preview((select j from t_in)) ->> 'contract_text' like 'CONTRAT DE PRESTATION%'
          and public.deal_preview((select j from t_in)) ->> 'contract_text' like '%Prix : 1 490,00 €, payable en une seule fois%'
          and public.deal_preview((select j from t_in)) ->> 'contract_text' not like '%par mois%',
  '... contrat de prestation : prix total, payé en une fois, rien par mois');
-- Facilités de paiement : 3 fois sans frais, commission à chaque prélèvement.
select is((public.deal_preview((select j from t_in) || '{"installments": 3}') ->> 'monthly_price_cents')::int, 49666, '3 fois : 496,66 € par prélèvement');
select is((public.deal_preview((select j from t_in) || '{"installments": 3}') ->> 'commission_cents')::int, 7449, '... commission de 74,49 € à chaque prélèvement');
select ok(public.deal_preview((select j from t_in) || '{"installments": 3}') ->> 'contract_text' like '%payable en 3 fois sans frais%3 prélèvements SEPA mensuels de 496,66 €%',
  '... échéancier écrit dans le contrat');
select throws_ok($$select public.deal_preview((select j from t_in) || '{"installments": 12}')$$, '22023', 'invalid_installments', '12 fois non proposé pour un site vitrine');
select throws_ok($$select public.deal_preview((select j from t_in) || '{"offer_id": "alma-pro", "installments": 3}')$$, '22023', 'invalid_installments',
  'abonnement mensuel : pas de paiement en plusieurs fois');
insert into t_deal select (public.deal_sign((select j from t_in), (select s from t_sig), public.deal_preview((select j from t_in)) ->> 'contract_sha256') ->> 'id')::uuid;
select ok((select id from t_deal) is not null, 'gratuit : le client signe l''offre gros ticket');
select is((public.my_earnings() ->> 'pending_cents')::int, 22350, 'gains : 223,50 € en attente dès la signature');
select ok((public.my_earnings() -> 'pending_deals' -> 0 ->> 'one_time')::boolean, '... signalé comme paiement unique');
select is((public.my_earnings() ->> 'pending_monthly_cents')::int, 0, '... rien dans le revenu mensuel');
select is(public.my_deals() -> 0 ->> 'billing', 'unique', 'deals : paiement unique');
reset role;

-- Mollie : un seul prélèvement du montant total.
update public.deals set withdrawal_until = now() - interval '1 day';
select is((public.deal_mollie_pending(10) -> 0 ->> 'times')::int, 1, 'Mollie : abonnement limité à 1 prélèvement');
select is((select (public.deal_mollie_pending(10) -> 0 ->> 'amount_cents')::int), 149000, '... du montant total');
select public.deal_mollie_progress((select id from t_deal), 'cst_x', 'mdt_x', 'sub_x', public.paris_today() + 4);
select is(public.email_schedule_prenotifications(), 1, 'une seule pré-notification');

-- Paiement : commission disponible tout de suite, pas de client « actif » pour les niveaux.
select public.deal_payment_from_mollie('sub_x', public.paris_today(), 149000, 'tr_x');
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select is((public.my_earnings() ->> 'available_cents')::int, 22350, 'prélevé : 223,50 € disponibles tout de suite');
select is((select active_clients from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 0,
  '... un paiement unique ne compte pas comme client actif pour les niveaux');
reset role;

select * from finish();
rollback;
