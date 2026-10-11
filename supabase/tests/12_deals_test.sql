-- Lot 5 : deals et gains. Catalogue, validation, contrat rendu par le serveur
-- (aperçu = signature), signature, IBAN chiffré, cloisonnement entre stackers,
-- paiements → commissions au taux du niveau, progression, virements, export.
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
  "email": "Contact@Boulangerie-Test.fr", "phone": "+33612345678", "iban_holder": "Boulangerie Test",
  "iban": "fr76 3000 6000 0112 3456 7890 189", "accept_terms": true, "accept_mandate": true}');
grant select on t_in to authenticated, service_role;
create temporary table t_sig (s text) on commit drop;
insert into t_sig values ('data:image/png;base64,' || repeat('iVBORw0KGgo', 300));
grant select on t_sig to authenticated, service_role;
create temporary table t_claim (id uuid) on commit drop;
grant all on t_claim to authenticated;
select public.prospects_cache_put(repeat('a', 64), '{"t": 1}', 1,
  jsonb_build_array(jsonb_build_object('siret', '40000000100018', 'name', 'Entreprise Prospect', 'department', '30')));

-- ---------------------------------------------------------------- aides
select ok(public.iban_is_valid('FR76 3000 6000 0112 3456 7890 189'), 'iban_is_valid : IBAN français valide');
select ok(not public.iban_is_valid('FR76 3000 6000 0112 3456 7890 188'), '... clé fausse refusée');
select ok(not public.iban_is_valid('FR76300060000112345678901'), '... longueur française fausse refusée');
select is(public.eur(123456), '1 234,56 €', 'eur : séparateur de milliers et virgule');

-- ---------------------------------------------------------------- accès
set local role anon;
select throws_ok($$select public.deal_catalog()$$, '42501', null, 'anon : catalogue interdit');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "role": "authenticated"}';
select throws_ok($$select public.deal_catalog()$$, '42501', 'onboarding_required', 'onboarding non terminé ⇒ onboarding_required');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select is(jsonb_array_length(public.deal_catalog() -> 'offers'), 29, 'catalogue : uniquement les offres actives');
select ok(not exists (select 1 from jsonb_array_elements(public.deal_catalog() -> 'offers') o where o ->> 'id' like 'rh-pme%'), '... une offre désactivée n''apparaît pas');
select is((public.deal_catalog() ->> 'rate_bps')::int, 1500, '... taux du niveau Rookie : 15 %');
select throws_ok($$select * from public.deals$$, '42501', null, 'lecture directe de deals interdite');
select throws_ok($$select * from public.offers$$, '42501', null, 'lecture directe de offers interdite');

-- ---------------------------------------------------------------- validation
select throws_ok($$select public.deal_preview((select j from t_in) || '{"siret": "73282932000075"}')$$, '22023', 'invalid_siret', 'SIRET faux ⇒ invalid_siret');
select throws_ok($$select public.deal_preview((select j from t_in) || '{"iban": "FR7630006000011234567890188"}')$$, '22023', 'invalid_iban', 'IBAN faux ⇒ invalid_iban');
select throws_ok($$select public.deal_preview((select j from t_in) || '{"email": "pas-un-email"}')$$, '22023', 'invalid_email', 'email faux ⇒ invalid_email');
select throws_ok($$select public.deal_preview((select j from t_in) || '{"phone": "0612345678"}')$$, '22023', 'invalid_phone', 'téléphone non E.164 ⇒ invalid_phone');
select throws_ok($$select public.deal_preview((select j from t_in) || '{"accept_mandate": false}')$$, '22023', 'consent_required', 'mandat non accepté ⇒ consent_required');
select throws_ok($$select public.deal_preview((select j from t_in) || '{"offer_id": "rh-pme-pro"}')$$, 'P0002', 'offer_unavailable', 'offre désactivée ⇒ offer_unavailable');
select throws_ok($$select public.deal_preview((select j from t_in) || '{"offer_id": "inroom-petite-structure", "quantity": 50}')$$, '22023', 'invalid_quantity', 'quantité hors palier ⇒ invalid_quantity');
select is((public.deal_preview((select j from t_in) || '{"offer_id": "inroom-hotel-moyen", "quantity": 30}') ->> 'monthly_price_cents')::int, 15000,
  'offre au nombre de chambres : 30 × 5 € = 150 €/mois');

-- ---------------------------------------------------------------- aperçu
create temporary table t_prev (p jsonb) on commit drop;
grant all on t_prev to authenticated;
insert into t_prev select public.deal_preview((select j from t_in));
select is((select (p ->> 'monthly_price_cents')::int from t_prev), 6999, 'aperçu : prix de l''offre');
select is((select (p ->> 'commission_cents')::int from t_prev), 1049, '... commission affichée = 15 % du prix (arrondi inférieur)');
select is((select p ->> 'contract_sha256' from t_prev), (select encode(extensions.digest(p ->> 'contract_text', 'sha256'), 'hex') from t_prev), '... empreinte = SHA-256 du texte');
select ok((select p ->> 'contract_text' like '%Boulangerie Test%SIRET 73282932000074%' from t_prev), '... contrat nominatif');
select ok((select p ->> 'contract_text' like '%FR76 •••• •••• 0189%' and p ->> 'contract_text' not like '%30006000011234567890%' from t_prev), '... IBAN masqué dans le contrat');
select ok((select p ->> 'contract_text' like '%Alice Martin%' and p ->> 'contract_text' like '%14 jours%' from t_prev), '... apporteur et rétractation de 14 jours');
select is(public.deal_preview((select j from t_in)) ->> 'contract_sha256', (select p ->> 'contract_sha256' from t_prev), '... aperçu stable pour une même saisie');

-- ---------------------------------------------------------------- signature
select throws_ok($$select public.deal_sign((select j from t_in), (select s from t_sig), repeat('0', 64))$$, '40001', 'contract_changed', 'empreinte différente ⇒ contract_changed');
select throws_ok($$select public.deal_sign((select j from t_in), 'data:image/jpeg;base64,AAAA', (select p ->> 'contract_sha256' from t_prev))$$, '22023', 'invalid_signature', 'signature absente ou invalide ⇒ invalid_signature');
select lives_ok($$select public.deal_sign((select j from t_in), (select s from t_sig), (select p ->> 'contract_sha256' from t_prev))$$, 'A fait signer le client');
select throws_ok($$select public.deal_sign((select j from t_in), (select s from t_sig), (select p ->> 'contract_sha256' from t_prev))$$, '23505', 'already_signed', 'même contrat deux fois ⇒ already_signed');
select is(jsonb_array_length(public.my_deals()), 1, 'my_deals : le deal signé');
select is(public.my_deals() -> 0 ->> 'status', 'signe', '... statut « signé »');
select ok(public.deal_detail((select (x ->> 'id')::uuid from jsonb_array_elements(public.my_deals()) x)) ->> 'iban_masked' = 'FR•• •••• 0189', 'deal_detail : IBAN masqué');
insert into t_claim select public.prospect_claim('40000000100018');
select lives_ok($$select public.deal_sign(x, (select s from t_sig), public.deal_preview(x) ->> 'contract_sha256')
                  from (select (select j from t_in) || jsonb_build_object('siret', '40000000100018', 'offer_id', 'seoia-pro', 'claim_id', (select id from t_claim)) x) q$$,
  'deal signé depuis un prospect réservé');
select is((select x ->> 'status' from jsonb_array_elements(public.my_prospects()) x where (x ->> 'id')::uuid = (select id from t_claim)), 'signe',
  '... le prospect passe automatiquement à « signé »');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select throws_ok($$select public.deal_sign(x, (select s from t_sig), public.deal_preview(x) ->> 'contract_sha256')
                   from (select (select j from t_in) || jsonb_build_object('offer_id', 'gmb-pro', 'claim_id', (select id from t_claim)) x) q$$,
  'P0002', 'not_found', 'B ne peut pas rattacher un deal au prospect de A');
reset role;

select is((select extensions.pgp_sym_decrypt(iban_enc, public.iban_key()) from public.deals where offer_id = 'alma-pro'), 'FR7630006000011234567890189', 'IBAN stocké chiffré, déchiffrable par le serveur');
select ok((select position('3000600001' in encode(iban_enc, 'escape')) = 0 from public.deals where offer_id = 'alma-pro'), '... jamais en clair');
select is((select contact_email from public.deals where offer_id = 'alma-pro'), 'contact@boulangerie-test.fr', 'email normalisé en minuscules');
select ok((select withdrawal_until between now() + interval '13 days 23 hours' and now() + interval '14 days 1 hour' from public.deals where offer_id = 'alma-pro'), 'fin de rétractation à 14 jours');

create temporary table t_deal on commit drop as select id from public.deals where offer_id = 'alma-pro';
grant select on t_deal to authenticated, service_role;

-- ---------------------------------------------------------------- cloisonnement
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select is(jsonb_array_length(public.my_deals()), 0, 'B ne voit pas les deals de A');
select throws_ok($$select public.deal_detail((select id from t_deal))$$, 'P0002', 'not_found', 'B : fiche du deal de A ⇒ not_found');
select throws_ok($$select public.deal_record_payment((select id from t_deal), current_date, 6999, 'x')$$, '42501', null, 'stacker : enregistrer un paiement interdit');
select is((public.my_earnings() ->> 'available_cents')::int, 0, 'B : aucun gain');
reset role;

-- ---------------------------------------------------------------- paiements → commissions
set local role service_role;
select lives_ok($$select public.deal_record_payment((select id from t_deal), date '2026-11-15', 6999, 'tr_1')$$, 'serveur : paiement du client enregistré');
create temporary table t_pay on commit drop as select public.deal_record_payment((select id from t_deal), date '2026-11-01', 6999, 'tr_1') as pid;
reset role;
select is((select pid from t_pay), (select id from public.deal_payments limit 1), '... idempotent pour le même mois');
select is((select count(*)::int from public.commission_entries), 1, 'une seule commission par mois payé');
select is((select amount_cents from public.commission_entries), 1049, '... 15 % de 69,99 €');
select is((select status::text from public.deals where offer_id = 'alma-pro'), 'actif', 'premier paiement ⇒ client actif');
select is((select active_clients from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 1, '... compté dans les clients actifs de A');

-- Progression : 3 clients actifs ⇒ Pro (18 %) pour les paiements suivants.
insert into public.deals (reference, stacker_id, offer_id, offer_snapshot, monthly_price_cents, company_siret, company_name, company_address,
  contact_first_name, contact_last_name, contact_role, contact_email, contact_phone, iban_holder, iban_country, iban_last4, iban_enc,
  mandate_ref, contract_version, contract_text, contract_sha256, signature_png, withdrawal_until)
select 'STK-T' || i, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alma-pro', '{}', 10000, '73282932000074', 'Client ' || i, 'adresse',
  'A', 'B', 'Gérant', 'a@b.fr', '+33600000000', 'X', 'FR', '0000', '\x00', 'RUM-T' || i, 'v', 't', repeat('a', 64), 's', now()
from generate_series(1, 2) i;
set local role service_role;
reset role;
select public.deal_record_payment(id, date '2026-11-01', 10000, null) from public.deals where reference like 'STK-T%';
select is((select tier from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'pro', '3 clients actifs ⇒ niveau Pro');
select public.deal_record_payment(id, date '2026-12-01', 10000, null) from public.deals where reference = 'STK-T1';
select is((select rate_bps from public.commission_entries e join public.deal_payments p on p.id = e.payment_id
           join public.deals d on d.id = e.deal_id where d.reference = 'STK-T1' and p.period = '2026-12-01'), 1800,
          'paiement suivant commissionné au taux Pro (18 %)');

-- ---------------------------------------------------------------- virements
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select is((public.my_earnings() ->> 'available_cents')::int, 1049 + 1500 + 1500 + 1800, 'my_earnings : solde disponible = somme des commissions');
select throws_ok($$select public.payout_request()$$, '55000', 'payout_account_required', 'virement sans IBAN ⇒ payout_account_required');
select throws_ok($$select public.payout_set_account('Alice Martin', 'FR00 1234')$$, '22023', 'invalid_iban', 'IBAN de virement faux ⇒ invalid_iban');
select lives_ok($$select public.payout_set_account('Alice Martin', 'FR7630006000011234567890189')$$, 'IBAN de virement enregistré');
select lives_ok($$select public.payout_request()$$, 'demande de virement de tout le solde');
select throws_ok($$select public.payout_request()$$, '55000', 'payout_pending', 'une seule demande à la fois');
select is((public.my_earnings() ->> 'available_cents')::int, 0, '... solde disponible à zéro, montant « demandé »');
reset role;
create temporary table t_po on commit drop as select id from public.payouts;
grant select on t_po to service_role;
set local role service_role;
select lives_ok($$select public.payout_mark((select id from t_po), 'verse', 'vir_1')$$, 'serveur : virement effectué');
reset role;
select is((select count(*)::int from public.commission_entries where status = 'versee'), 4, 'commissions passées en « versée »');

-- ---------------------------------------------------------------- résiliation, export, suppression du compte
create temporary table t_t2 on commit drop as select id from public.deals where reference = 'STK-T2';
grant select on t_t2 to service_role;
set local role service_role;
select lives_ok($$select public.deal_set_status((select id from t_t2), 'resilie', 'demande client')$$, 'résiliation d''un client');
select throws_ok($$select public.deal_record_payment((select id from t_t2), date '2027-01-01', 10000, null)$$, '55000', 'deal_closed', 'paiement sur un contrat résilié ⇒ deal_closed');
reset role;
select is((select active_clients from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 2, '... clients actifs recomptés');

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select ok(jsonb_array_length(public.export_my_data() -> 'deals') = 4 and public.export_my_data()::text not like '%30006000011234567890%',
  'export RGPD : deals inclus, sans IBAN');
reset role;

delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is((select count(*)::int from public.deals where stacker_id is null), 4, 'compte supprimé : deals conservés et anonymisés');

select * from finish();
rollback;
