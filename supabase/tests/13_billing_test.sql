-- Lot 6 : paiements Mollie. Abonnement stacker (premier paiement, places de
-- lancement, renouvellement sur les gains ou le mandat, grâce, résiliation),
-- accès conditionné à l'abonnement, prélèvement des clients (mise en place,
-- paiements, contestation → reprise, résiliation → arrêt), cloisonnement.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(66);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Alice"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Bob"}'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'chloe@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Chloé"}');
update public.profiles set onboarding_completed_at = now(), department = '30', last_name = 'Martin'
where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- Saisie type (données de TEST) : SIRET et IBAN d'exemple valides.
create temporary table t_in (j jsonb) on commit drop;
insert into t_in values ('{"offer_id": "alma-pro", "quantity": 1, "siret": "73282932000074", "company_name": "Boulangerie Test",
  "company_address": "1 rue de la Paix, 30000 Nîmes", "first_name": "Jean", "last_name": "Dupont", "role": "Gérant",
  "email": "contact@boulangerie-test.fr", "phone": "+33612345678", "iban_holder": "Boulangerie Test",
  "iban": "FR7630006000011234567890189", "accept_terms": true, "accept_mandate": true}');
grant select on t_in to authenticated, service_role;
create temporary table t_sig (s text) on commit drop;
insert into t_sig values ('data:image/png;base64,' || repeat('iVBORw0KGgo', 300));
grant select on t_sig to authenticated, service_role;
create temporary table t_today on commit drop as select public.paris_today() as d;
grant select on t_today to authenticated, service_role;
create temporary table t_out (j jsonb) on commit drop;
grant all on t_out to authenticated, service_role;

-- ---------------------------------------------------------------- état initial
set local role anon;
select throws_ok($$select public.my_billing()$$, '42501', null, 'anon : my_billing interdit');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select is(public.my_billing() ->> 'status', 'aucun', 'my_billing : aucun abonnement au départ');
select ok(not (public.my_billing() ->> 'required')::boolean and (public.my_billing() ->> 'has_access')::boolean,
  '... abonnement non exigé tant que l''interrupteur est coupé : accès ouvert');
select is((public.my_billing() ->> 'launch_seats_left')::int, 100, '... 100 places de lancement');
select is((public.my_billing() ->> 'price_cents')::int, 699, '... 6,99 €/mois');
select throws_ok($$select * from public.stacker_billing$$, '42501', null, 'lecture directe de stacker_billing interdite');
select throws_ok($$select * from public.billing_charges$$, '42501', null, 'lecture directe de billing_charges interdite');
select throws_ok($$select public.billing_payment_paid('tr_x', 'mdt_x', 'x')$$, '42501', null, 'stacker : confirmer un paiement interdit');
select throws_ok($$select public.billing_checkout_prepare('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-10-12', true)$$, '42501', null, 'stacker : préparer un paiement pour un autre interdit');
select throws_ok($$select public.deal_mollie_pending(10)$$, '42501', null, 'stacker : lire les IBAN à déclarer interdit');
reset role;

-- ---------------------------------------------------------------- abonnement exigé
update public.app_flags set enabled = true where key = 'billing_required';
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select ok(not (public.my_billing() ->> 'has_access')::boolean, 'interrupteur activé : plus d''accès sans abonnement');
select throws_ok($$select public.deal_preview((select j from t_in))$$, 'P0001', 'subscription_required', 'sans abonnement : aperçu de contrat refusé');
select throws_ok($$select public.deal_sign((select j from t_in), (select s from t_sig), repeat('0', 64))$$, 'P0001', 'subscription_required', '... signature refusée');
select throws_ok($$select public.prospect_claim('73282932000074')$$, 'P0001', 'subscription_required', '... réservation de prospect refusée');
select lives_ok($$select public.my_earnings()$$, '... les gains restent consultables');
reset role;

-- ---------------------------------------------------------------- premier paiement
set local role service_role;
select throws_ok($$select public.billing_checkout_prepare('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '2026-10-12', true)$$, 'P0001', 'onboarding_required', 'onboarding non terminé ⇒ pas de paiement');
insert into t_out select public.billing_checkout_prepare('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-10-12', true);
select ok((select j ->> 'email' = 'alice@exemple.fr' and (j ->> 'amount_cents')::int = 699 and j ->> 'customer_id' is null from t_out),
  'préparation : email, montant, pas encore de client Mollie');
select public.billing_set_customer('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cst_alice');
select public.billing_charge_created('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'premier', (select d from t_today), 699, 'tr_a1');
select public.billing_payment_failed('tr_a1');
reset role;
select is((select status from public.stacker_billing where stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'aucun', 'premier paiement échoué : toujours aucun abonnement');
select is((select status from public.billing_charges where mollie_payment_id = 'tr_a1'), 'echoue', '... paiement noté échoué');

set local role service_role;
truncate t_out;
insert into t_out select public.billing_checkout_prepare('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-10-12', true);
select is((select j ->> 'customer_id' from t_out), 'cst_alice', 'nouvel essai : client Mollie réutilisé');
select lives_ok($$select public.billing_charge_created('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'premier', (select d from t_today), 699, 'tr_a2')$$,
  '... nouveau paiement pour la même période après un échec');
select public.billing_payment_paid('tr_a2', 'mdt_alice', 'Carte •••• 4242');
select public.billing_payment_paid('tr_a2', 'mdt_alice', 'Carte •••• 4242');
select throws_ok($$select public.billing_checkout_prepare('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-10-12', true)$$, 'P0001', 'already_active', 'abonné à jour : pas de second paiement');
reset role;
select ok((select status = 'actif' and mollie_mandate_id = 'mdt_alice' and method_label = 'Carte •••• 4242'
           from public.stacker_billing where stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'paiement confirmé : abonnement actif, mandat enregistré');
select is((select current_period_end from public.stacker_billing where stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ((select d from t_today) + interval '1 month')::date, '... payé pour un mois (confirmation reçue deux fois : un seul mois)');
select ok((select launch_member and launch_until = ((select d from t_today) + interval '12 months')::date
           from public.stacker_billing where stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), '... place de lancement pour 12 mois');

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select ok((public.my_billing() ->> 'has_access')::boolean and (public.my_billing() ->> 'launch_member')::boolean, 'my_billing : accès et membre du lancement');
select is((public.my_billing() ->> 'launch_seats_left')::int, 99, '... 99 places restantes');
select is(jsonb_array_length(public.my_billing() -> 'charges'), 2, '... historique des 2 tentatives');
select ok(public.deal_preview((select j from t_in)) ->> 'contract_text' like '%prévenu par email au moins 2 jours avant chaque prélèvement%',
  'contrat : pré-notification SEPA au moins 2 jours avant chaque prélèvement');
select lives_ok($$select public.deal_sign((select j from t_in), (select s from t_sig), public.deal_preview((select j from t_in)) ->> 'contract_sha256')$$,
  'abonné : peut faire signer un client');
reset role;

-- ---------------------------------------------------------------- places de lancement
update public.billing_settings set launch_seats = 1;
update public.profiles set launch_priority = false where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role service_role;
select public.billing_checkout_prepare('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-10-12', true);
select public.billing_set_customer('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cst_bob');
select public.billing_charge_created('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'premier', (select d from t_today), 699, 'tr_b1');
select public.billing_payment_paid('tr_b1', 'mdt_bob', 'SEPA •••• 0189');
reset role;
select ok((select status = 'actif' and not launch_member and launch_until is null from public.stacker_billing where stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  'places épuisées : abonné, mais hors offre de lancement');

-- ---------------------------------------------------------------- prélèvement du client
create temporary table t_deal on commit drop as select id, (withdrawal_until at time zone 'Europe/Paris')::date + 1 as first_debit from public.deals where offer_id = 'alma-pro';
grant select on t_deal to authenticated, service_role;
set local role service_role;
truncate t_out;
insert into t_out select public.deal_mollie_pending(10);
select is((select jsonb_array_length(j) from t_out), 1, 'mise en place Mollie : le deal signé est à déclarer');
select ok((select j -> 0 ->> 'iban' = 'FR7630006000011234567890189' and j -> 0 ->> 'mandate_ref' like 'STKM%' and (j -> 0 ->> 'amount_cents')::int = 6999 from t_out),
  '... IBAN déchiffré, RUM et montant pour le serveur');
select is((select (j -> 0 ->> 'first_debit_on')::date from t_out), (select first_debit from t_deal),
  '... premier prélèvement le lendemain de la fin de rétractation');
select public.deal_mollie_progress((select id from t_deal), 'cst_boul', 'mdt_boul', null, null);
select public.deal_mollie_failed((select id from t_deal), 'timeout', false);
select is(jsonb_array_length(public.deal_mollie_pending(10)), 1, 'erreur passagère : le deal sera retenté');
select public.deal_mollie_progress((select id from t_deal), null, null, 'sub_boul', ((select d from t_today) + 15));
select is(jsonb_array_length(public.deal_mollie_pending(10)), 0, 'abonnement Mollie créé : plus rien à déclarer');
reset role;
select ok((select mollie_status = 'fait' and mollie_customer_id = 'cst_boul' and mollie_mandate_id = 'mdt_boul' and mollie_error is null and mollie_attempts = 2
           from public.deals where id = (select id from t_deal)), '... client, mandat et abonnement enregistrés');

set local role service_role;
select throws_ok($$select public.deal_payment_from_mollie('sub_inconnu', date '2026-11-01', 6999, 'tr_c0')$$, 'P0002', 'not_found', 'paiement d''un abonnement inconnu ⇒ not_found');
select lives_ok($$select public.deal_payment_from_mollie('sub_boul', date '2026-11-01', 6999, 'tr_c1')$$, 'paiement du client confirmé par Mollie');
reset role;
select is((select status::text from public.deals where id = (select id from t_deal)), 'actif', '... deal actif');
select is((select amount_cents from public.commission_entries where kind = 'commission' and deal_id = (select id from t_deal)), 1049, '... commission de 15 % créée');

-- ---------------------------------------------------------------- renouvellement
-- La commission est disponible, le mois d'Alice arrive à échéance : payé sur les gains.
update public.commission_entries set available_at = now() - interval '1 day' where deal_id = (select id from t_deal);
-- (simule un mois écoulé depuis le premier paiement)
update public.billing_charges set period_start = (period_start - interval '1 month')::date where kind = 'premier';
update public.stacker_billing set current_period_end = (select d from t_today) where stacker_id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
set local role service_role;
truncate t_out;
insert into t_out select public.billing_renew_due(50);
reset role;
select ok((select method = 'commissions' and status = 'paye' and amount_cents = 699 from public.billing_charges
           where stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and kind = 'mensuel'), 'renouvellement : payé sur les gains disponibles');
select is(public.available_balance('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 350, '... 10,49 € − 6,99 € = 3,50 € restants');
select is((select current_period_end from public.stacker_billing where stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ((select d from t_today) + interval '1 month')::date, '... mois suivant payé');
select ok((select jsonb_array_length(j) = 1 and j -> 0 ->> 'mandate_id' = 'mdt_bob' from t_out), 'sans gains suffisants : prélèvement à faire sur le mandat (Bob)');

set local role service_role;
select public.billing_charge_created('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'mensuel', (select d from t_today), 699, 'tr_b2');
select is(jsonb_array_length(public.billing_renew_due(50)), 0, '... prélèvement en cours : pas demandé deux fois');
select public.billing_payment_failed('tr_b2');
reset role;
select is((select status from public.stacker_billing where stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'impaye', 'prélèvement mensuel refusé : impayé');
select ok(public.stacker_has_access('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), '... accès gardé pendant les 3 jours de grâce');
update public.stacker_billing set current_period_end = (select d from t_today) - 4 where stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
set local role service_role;
select public.billing_renew_due(50);
reset role;
select ok((select status = 'resilie' from public.stacker_billing where stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
          and not public.stacker_has_access('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'grâce dépassée : abonnement résilié, accès coupé');

-- ---------------------------------------------------------------- gains vus par le stacker
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select is((public.my_earnings() ->> 'available_cents')::int, 350, 'my_earnings : solde net de l''abonnement');
select ok(exists (select 1 from jsonb_array_elements(public.my_earnings() -> 'entries') x where x ->> 'kind' = 'abonnement' and (x ->> 'amount_cents')::int = -699 and x ->> 'company_name' is null),
  '... ligne « abonnement » dans l''historique');
reset role;

-- ---------------------------------------------------------------- contestation
set local role service_role;
select public.deal_payment_reversed('tr_c1');
select public.deal_payment_reversed('tr_c1');
reset role;
select is((select sum(amount_cents)::int from public.commission_entries where deal_id = (select id from t_deal) and kind = 'reprise'), -1049,
  'paiement contesté : commission reprise une seule fois');
select is((select status::text from public.deals where id = (select id from t_deal)), 'suspendu', '... deal suspendu');
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select ok((select jsonb_array_length(d -> 'payments') = 1 and (d -> 'payments' -> 0 ->> 'reversed')::boolean and (d -> 'payments' -> 0 ->> 'commission_cents')::int = 1049
           from (select public.deal_detail((select id from t_deal)) d) q), 'fiche deal : paiement marqué remboursé, sans doublon');
select is((public.my_earnings() ->> 'available_cents')::int, -699, '... solde négatif, déduit des prochaines commissions');
select public.payout_set_account('Alice Martin', 'FR7630006000011234567890189');
select throws_ok($$select public.payout_request()$$, '22023', 'payout_too_small', '... aucun virement possible');
reset role;

-- ---------------------------------------------------------------- résiliation
set local role service_role;
select public.deal_set_status((select id from t_deal), 'resilie', 'demande du client');
select is(public.deal_mollie_cancels(10) -> 0 ->> 'subscription_id', 'sub_boul', 'résiliation : abonnement Mollie à arrêter');
select public.deal_mollie_cancelled((select id from t_deal));
select is(jsonb_array_length(public.deal_mollie_cancels(10)), 0, '... arrêté, plus rien à transmettre');
reset role;

-- ---------------------------------------------------------------- page de paiement rouverte
update public.profiles set onboarding_completed_at = now() where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local role service_role;
select public.billing_checkout_prepare('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '2026-10-12', true);
select public.billing_charge_created('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'premier', (select d from t_today), 699, 'tr_ch1');
select public.billing_charge_created('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'premier', (select d from t_today), 699, 'tr_ch2');
reset role;
select is((select status from public.billing_charges where mollie_payment_id = 'tr_ch1'), 'echoue', 'page rouverte : l''ancien paiement en attente est remplacé');
set local role service_role;
select public.billing_payment_paid('tr_ch1', 'mdt_chloe', 'Carte •••• 1111');
select public.billing_payment_paid('tr_ch2', 'mdt_chloe', 'Carte •••• 1111');
select public.billing_charge_created('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'premier', (select d from t_today), 699, 'tr_ch2');
reset role;
select is((select count(*)::int from public.billing_charges where stacker_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and status = 'paye'), 2,
  '... les deux paiements finalement payés sont acceptés');
select is((select current_period_end from public.stacker_billing where stacker_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ((select d from t_today) + interval '2 months')::date, '... payé deux fois : deux mois couverts, rien de perdu');

-- ---------------------------------------------------------------- résiliation par le stacker
set local role authenticated;
set local request.jwt.claims = '{"sub": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "role": "authenticated"}';
select ok((public.billing_set_auto_renew(false) ->> 'cancel_at_period_end')::boolean, 'résiliation demandée par le stacker');
select ok((public.my_billing() ->> 'has_access')::boolean, '... accès gardé jusqu''à la fin de la période payée');
reset role;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
set local role authenticated;
select throws_ok($$select public.billing_set_auto_renew(false)$$, 'P0002', 'no_subscription', 'abonnement déjà terminé : rien à résilier');
reset role;
update public.stacker_billing set current_period_end = (select d from t_today) where stacker_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local role service_role;
select is(jsonb_array_length(public.billing_renew_due(50)), 0, '... aucun renouvellement demandé');
reset role;
select ok((select status = 'resilie' from public.stacker_billing where stacker_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
          and not public.stacker_has_access('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), '... fin de période : abonnement terminé, sans délai de grâce');

select * from finish();
rollback;
