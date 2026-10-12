-- Lot 7 : emails transactionnels. File alimentée par la base (signature,
-- inscription, paiements refusés, abonnement coupé), pré-notification SEPA
-- au moins 2 jours avant chaque prélèvement, envoi, nouvel essai, purge des
-- emails d'un compte supprimé, cloisonnement.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(32);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Alice"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Bob"}');
update public.profiles set onboarding_completed_at = now(), department = '30', last_name = 'Martin'
where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

create temporary table t_today on commit drop as select public.paris_today() as d;
grant select on t_today to authenticated, service_role;
create temporary table t_in (j jsonb) on commit drop;
insert into t_in values ('{"offer_id": "alma-pro", "quantity": 1, "siret": "73282932000074", "company_name": "Boulangerie Test",
  "company_address": "1 rue de la Paix, 30000 Nîmes", "first_name": "Jean", "last_name": "Dupont", "role": "Gérant",
  "email": "contact@boulangerie-test.fr", "phone": "+33612345678", "iban_holder": "Boulangerie Test",
  "iban": "FR7630006000011234567890189", "accept_terms": true, "accept_mandate": true}');
grant select on t_in to authenticated;
create temporary table t_sig (s text) on commit drop;
insert into t_sig values ('data:image/png;base64,' || repeat('iVBORw0KGgo', 300));
grant select on t_sig to authenticated;
create temporary table t_out (j jsonb) on commit drop;
grant all on t_out to service_role;

-- ---------------------------------------------------------------- bienvenue
select is((select count(*)::int from public.email_outbox where kind = 'bienvenue'), 2, 'inscription terminée : un email de bienvenue par stacker');
update public.profiles set city = 'Nîmes' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is((select count(*)::int from public.email_outbox where kind = 'bienvenue'), 2, '... pas de doublon quand le profil change');

-- ---------------------------------------------------------------- contrat signé
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select lives_ok($$select public.deal_sign((select j from t_in), (select s from t_sig), public.deal_preview((select j from t_in)) ->> 'contract_sha256')$$, 'A fait signer un client');
select throws_ok($$select * from public.email_outbox$$, '42501', null, 'stacker : lecture de la file interdite');
select throws_ok($$select public.email_next(10)$$, '42501', null, 'stacker : prendre des emails à envoyer interdit');
reset role;
create temporary table t_deal on commit drop as select id from public.deals where offer_id = 'alma-pro';
grant select on t_deal to service_role;

select ok((select client_email = 'contact@boulangerie-test.fr' and stacker_id is null from public.email_outbox where kind = 'contrat_client'),
  'contrat au client : à son adresse, sans lien avec le compte du stacker');
select ok((select client_email is null and stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' from public.email_outbox where kind = 'contrat_stacker'),
  'contrat au stacker : adresse lue à l''envoi');

-- ---------------------------------------------------------------- envoi
set local role service_role;
insert into t_out select public.email_next(10);
reset role;
select is((select jsonb_array_length(j) from t_out), 4, 'email_next : bienvenue ×2 et contrat ×2');
select ok((select bool_and(x ->> 'to' in ('alice@exemple.fr', 'bob@exemple.fr', 'contact@boulangerie-test.fr')) from t_out, jsonb_array_elements(j) x), '... destinataires résolus');
select ok((select x -> 'deal' ->> 'signature_png' like 'data:image/png;base64,%' and x -> 'deal' ->> 'contract_text' like '%Boulangerie Test%'
           and x ->> 'to_name' = 'Jean Dupont' and x -> 'stacker' ->> 'first_name' = 'Alice'
           from t_out, jsonb_array_elements(j) x where x ->> 'kind' = 'contrat_client'), '... contrat, signature, client et stacker pour rédiger');
select ok((select bool_and(x -> 'deal' = 'null'::jsonb) from t_out, jsonb_array_elements(j) x where x ->> 'kind' = 'bienvenue'),
  '... pas de contrat dans les autres emails');
select ok((select x -> 'deal' ->> 'iban_masked' = 'FR•• •••• 0189' and x::text not like '%30006000011234567890%' from t_out, jsonb_array_elements(j) x where x ->> 'kind' = 'contrat_stacker'),
  '... IBAN masqué, jamais en clair');
select is(jsonb_array_length(public.email_next(10)), 0, 'pris une fois : pas renvoyé immédiatement');

set local role service_role;
select public.email_result((x ->> 'id')::bigint, true, null) from t_out, jsonb_array_elements(j) x where x ->> 'kind' <> 'contrat_stacker';
select public.email_result((x ->> 'id')::bigint, false, 'brevo_500') from t_out, jsonb_array_elements(j) x where x ->> 'kind' = 'contrat_stacker';
reset role;
select is((select count(*)::int from public.email_outbox where status = 'envoye' and sent_at is not null), 3, 'envois confirmés');
select ok((select status = 'a_envoyer' and last_error = 'brevo_500' and attempts = 1 and send_after > now() + interval '10 minutes' from public.email_outbox where kind = 'contrat_stacker'),
  'échec passager : nouvel essai un peu plus tard');
update public.email_outbox set send_after = now() - interval '1 second', attempts = 5 where kind = 'contrat_stacker';
select is(jsonb_array_length(public.email_next(10)), 1, '... repris quand c''est l''heure');
select is((select status from public.email_outbox where kind = 'contrat_stacker'), 'echoue', '... abandonné à la 6e tentative s''il échoue encore');

-- ---------------------------------------------------------------- pré-notification
update public.deals set mollie_status = 'fait', first_debit_on = (select d from t_today) + 4 where id = (select id from t_deal);
set local role service_role;
select is(public.email_schedule_prenotifications(), 1, 'prélèvement dans 4 jours : le client est prévenu');
select is(public.email_schedule_prenotifications(), 0, '... une seule fois par prélèvement');
reset role;
select ok((select client_email = 'contact@boulangerie-test.fr' and (data ->> 'debit_on')::date = (select d from t_today) + 4 and (data ->> 'amount_cents')::int = 6999
           from public.email_outbox where kind = 'prenotification'), '... montant et date du prélèvement');
update public.deals set first_debit_on = ((select d from t_today) + 5 - interval '2 months')::date where id = (select id from t_deal);
set local role service_role;
select is(public.email_schedule_prenotifications(), 1, 'prélèvements mensuels suivants annoncés aussi');
reset role;
update public.deals set first_debit_on = (select d from t_today) + 1 where id = (select id from t_deal);
set local role service_role;
select is(public.email_schedule_prenotifications(), 0, 'jamais moins de 3 jours avant (fenêtre dépassée : rien de nouveau)');
reset role;
update public.deals set first_debit_on = (select d from t_today) + 20 where id = (select id from t_deal);
set local role service_role;
select is(public.email_schedule_prenotifications(), 0, 'trop tôt : rien encore');
reset role;

-- ---------------------------------------------------------------- incidents
set local role service_role;
select public.deal_mollie_progress((select id from t_deal), null, null, 'sub_boul', null);
select public.deal_payment_failed_from_mollie('sub_boul', 'AM04');
reset role;
select ok((select stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and data ->> 'reason' like '%AM04%' from public.email_outbox where kind = 'prelevement_refuse'),
  'prélèvement du client refusé : le stacker est prévenu');

insert into public.stacker_billing (stacker_id, status, current_period_end, mollie_customer_id, mollie_mandate_id)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'actif', (select d from t_today), 'cst_b', 'mdt_b');
set local role service_role;
select public.billing_charge_created('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'mensuel', (select d from t_today), 699, 'tr_b9');
select public.billing_payment_failed('tr_b9');
reset role;
select ok((select stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and (data ->> 'grace_until')::date = (select d from t_today) + 3 from public.email_outbox where kind = 'abonnement_refuse'),
  'abonnement refusé : prévenu, avec la date de coupure');
update public.stacker_billing set status = 'resilie' where stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is((select count(*)::int from public.email_outbox where kind = 'abonnement_coupe'), 1, 'abonnement coupé faute de paiement : prévenu');
update public.stacker_billing set status = 'actif', cancel_at_period_end = true where stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
delete from public.email_outbox where kind = 'abonnement_coupe';
update public.stacker_billing set status = 'resilie' where stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is((select count(*)::int from public.email_outbox where kind = 'abonnement_coupe'), 0, '... pas après une résiliation voulue');

-- ---------------------------------------------------------------- deal terminé, compte supprimé
update public.email_outbox set status = 'a_envoyer', send_after = now() where kind = 'prenotification';
update public.deals set status = 'resilie' where id = (select id from t_deal);
set local role service_role;
select is((select count(*)::int from jsonb_array_elements(public.email_next(50)) x where x ->> 'kind' = 'prenotification'), 0, 'contrat résilié : prélèvements annoncés annulés');
reset role;
select is((select count(*)::int from public.email_outbox where kind = 'prenotification' and status = 'annule'), 2, '... marqués annulés');

delete from public.profiles where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is((select count(*)::int from public.email_outbox where stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0, 'compte supprimé : ses emails partent avec lui');

select public.email_result(id, false, 'no_recipient') from public.email_outbox where kind = 'prelevement_refuse';
select is((select status from public.email_outbox where kind = 'prelevement_refuse'), 'annule', 'sans destinataire : abandonné');

update public.email_outbox set created_at = now() - interval '91 days' where status = 'envoye';
set local role service_role;
select public.email_next(1);
reset role;
select is((select count(*)::int from public.email_outbox where status = 'envoye'), 0, 'emails envoyés effacés après 90 jours');

select * from finish();
rollback;
