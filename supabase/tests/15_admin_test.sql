-- Lot 8 : espace admin. Accès réservé aux admins (table admins), vue
-- d'ensemble, virements (IBAN complet pour l'admin seulement, versé / refusé,
-- stacker prévenu), deals, offres, stackers, interrupteurs, journal.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(30);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Alice"}'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'lucas@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Lucas"}');
update public.profiles set onboarding_completed_at = now(), department = '30', last_name = 'Martin' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.admins (user_id) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd');

create temporary table t_in (j jsonb) on commit drop;
insert into t_in values ('{"offer_id": "alma-pro", "quantity": 1, "siret": "73282932000074", "company_name": "Boulangerie Test",
  "company_address": "1 rue de la Paix, 30000 Nîmes", "first_name": "Jean", "last_name": "Dupont", "role": "Gérant",
  "email": "contact@boulangerie-test.fr", "phone": "+33612345678", "iban_holder": "Boulangerie Test",
  "iban": "FR7630006000011234567890189", "accept_terms": true, "accept_mandate": true}');
grant select on t_in to authenticated;
create temporary table t_sig (s text) on commit drop;
insert into t_sig values ('data:image/png;base64,' || repeat('iVBORw0KGgo', 300));
grant select on t_sig to authenticated;
create temporary table t_ids (k text primary key, id uuid) on commit drop;
grant all on t_ids to authenticated;

-- Alice signe un client, il paie, elle demande un virement.
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
insert into t_ids select 'deal', (public.deal_sign((select j from t_in), (select s from t_sig), public.deal_preview((select j from t_in)) ->> 'contract_sha256') ->> 'id')::uuid;
select public.payout_set_account('Alice Martin', 'BE68539007547034');
reset role;
select public.deal_record_payment((select id from t_ids where k = 'deal'), date '2026-11-01', 6999, 'tr_1');
update public.commission_entries set available_at = now() - interval '1 day';
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
insert into t_ids select 'payout', public.payout_request();

-- ---------------------------------------------------------------- accès
select ok(not public.is_admin(), 'stacker : pas admin');
select throws_ok($$select public.admin_overview()$$, '42501', 'forbidden', 'stacker : vue d''ensemble refusée');
select throws_ok($$select public.admin_payouts('demande')$$, '42501', 'forbidden', 'stacker : IBAN des autres refusés');
select throws_ok($$select public.admin_payout_mark((select id from t_ids where k = 'payout'), 'verse', null)$$, '42501', 'forbidden', 'stacker : marquer son virement versé refusé');
select throws_ok($$select public.admin_set_flag('billing_required', false)$$, '42501', 'forbidden', 'stacker : interrupteurs refusés');
select throws_ok($$select public.admin_offer_set_active('alma-pro', false)$$, '42501', 'forbidden', 'stacker : offres refusées');
select throws_ok($$insert into public.admins (user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$, '42501', null, 'stacker : se déclarer admin impossible');
select throws_ok($$select * from public.admin_log$$, '42501', null, 'stacker : journal illisible');
reset role;
set local role anon;
select throws_ok($$select public.admin_overview()$$, '42501', null, 'anon : refusé');
reset role;

-- ---------------------------------------------------------------- lecture
set local role authenticated;
set local request.jwt.claims = '{"sub": "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "role": "authenticated"}';
select ok(public.is_admin(), 'admin reconnu');
select ok((select (o ->> 'stackers')::int = 1 and (o -> 'deals' ->> 'actif')::int = 1 and (o ->> 'client_monthly_cents')::int = 6999
                  and (o ->> 'payouts_pending')::int = 1 and (o ->> 'payouts_pending_cents')::int = 1049 and (o -> 'flags' ->> 'billing_required')::boolean = false
           from (select public.admin_overview() o) q), 'vue d''ensemble : stackers, deals, revenus, virements, interrupteurs');
select ok((select p -> 0 ->> 'iban' = 'BE68539007547034' and p -> 0 ->> 'holder' = 'Alice Martin' and p -> 0 ->> 'stacker_email' = 'alice@exemple.fr'
                  and (p -> 0 ->> 'amount_cents')::int = 1049
           from (select public.admin_payouts('demande') p) q), 'virements : IBAN complet et titulaire pour faire le virement');
select throws_ok($$select public.admin_payouts('tout')$$, '22023', 'invalid_request', 'statut de virement inconnu refusé');
select is(jsonb_array_length(public.admin_deals(null, 'boulang')), 1, 'deals : recherche par nom');
select is(jsonb_array_length(public.admin_deals('actif', '732 829 320 00074')), 1, 'deals : recherche par SIRET et statut');
select is(jsonb_array_length(public.admin_deals('resilie', null)), 0, 'deals : filtre par statut');
select ok((select x ->> 'iban' is null and x::text not like '%30006000011234567890%' from jsonb_array_elements(public.admin_deals(null, null)) x limit 1),
  'deals : IBAN du client jamais affiché');
select ok((select (s -> 0 ->> 'available_cents')::int = 0 and s -> 0 ->> 'email' = 'alice@exemple.fr' from (select public.admin_stackers('alice') s) q),
  'stackers : recherche, solde (virement demandé déduit)');
select is((select (x ->> 'deals')::int from jsonb_array_elements(public.admin_offers()) x where x ->> 'id' = 'alma-pro'), 1, 'offres : nombre de deals par offre');

-- ---------------------------------------------------------------- actions
select throws_ok($$select public.admin_payout_mark((select id from t_ids where k = 'payout'), 'refuse', '')$$, '22023', 'invalid_request', 'refus sans motif impossible');
select lives_ok($$select public.admin_payout_mark((select id from t_ids where k = 'payout'), 'verse', 'VIR-2026-001')$$, 'virement marqué versé');
select throws_ok($$select public.admin_payout_mark((select id from t_ids where k = 'payout'), 'refuse', 'doublon')$$, '22023', 'invalid_transition', '... une seule fois');
select throws_ok($$select public.admin_deal_set_status((select id from t_ids where k = 'deal'), 'resilie', '')$$, '22023', 'invalid_request', 'résiliation sans motif impossible');
select lives_ok($$select public.admin_deal_set_status((select id from t_ids where k = 'deal'), 'resilie', 'demande du client par email')$$, 'deal résilié par l''admin');
select lives_ok($$select public.admin_offer_set_active('alma-pro', false)$$, 'offre désactivée');
select throws_ok($$select public.admin_set_flag('iban_key', true)$$, '22023', 'invalid_request', 'interrupteur inconnu refusé');
select lives_ok($$select public.admin_set_flag('billing_required', true)$$, 'abonnement rendu obligatoire');
reset role;

select ok((select status = 'versee' from public.commission_entries limit 1) and (select status = 'verse' and provider_ref = 'VIR-2026-001' from public.payouts),
  'virement versé : commissions versées, référence gardée');
select ok((select data ->> 'amount_cents' = '1049' from public.email_outbox where kind = 'virement_verse' and stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  '... le stacker est prévenu par email');
select is((select array_agg(action order by id) from public.admin_log), array['payout_verse', 'deal_resilie', 'offer_off', 'flag'],
  'journal : chaque action de l''admin');

select * from finish();
rollback;
