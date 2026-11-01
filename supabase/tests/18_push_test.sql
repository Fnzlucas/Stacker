-- Notifications push : enregistrement de l'appareil (cloisonné), mise en file
-- sur les événements (commission débloquée, virement envoyé, boîte à
-- reconnecter), rien sans appareil, lecture et résultat côté serveur, jetons
-- refusés par Apple supprimés.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(20);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Alice"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Bob"}');
update public.profiles set onboarding_completed_at = now(), department = '30', last_name = 'Martin';

-- ---------------------------------------------------------------- appareil
set local role anon;
select throws_ok($$select public.push_register('a' || repeat('0', 63), 'ios')$$, '42501', null, 'anon : enregistrement refusé');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select throws_ok($$select public.push_register('pas un jeton !', 'ios')$$, '22023', 'invalid_token', 'jeton invalide refusé');
select throws_ok($$select public.push_register(repeat('a', 64), 'windows')$$, '22023', 'invalid_token', 'plateforme inconnue refusée');
select lives_ok($$select public.push_register(repeat('a', 64), 'ios')$$, 'A enregistre son iPhone');
select lives_ok($$select public.push_register(repeat('a', 64), 'ios')$$, '... deux fois sans doublon');
select throws_ok($$select * from public.push_devices$$, '42501', null, 'lecture directe des appareils refusée');
select throws_ok($$select public.push_next(10)$$, '42501', null, 'lire la file (service) refusé au stacker');
reset role;
select is((select count(*)::int from public.push_devices), 1, 'un seul appareil enregistré');

-- Même téléphone, autre compte : le jeton suit le compte connecté.
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select public.push_register(repeat('a', 64), 'ios');
select public.push_unregister(repeat('z', 64));
reset role;
select is((select stacker_id::text from public.push_devices), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'changement de compte : le jeton suit');
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select public.push_unregister(repeat('a', 64));
select public.push_register(repeat('a', 64), 'ios');
select public.push_register(repeat('c', 64), 'ios');
reset role;
select is((select count(*)::int from public.push_devices where stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 2, 'A : deux appareils');

-- ---------------------------------------------------------------- événements
insert into public.deals (reference, stacker_id, offer_id, offer_snapshot, monthly_price_cents, company_siret, company_name, company_address,
  contact_first_name, contact_last_name, contact_role, contact_email, contact_phone, iban_holder, iban_country, iban_last4, iban_enc,
  mandate_ref, contract_version, contract_text, contract_sha256, signature_png, withdrawal_until)
values ('STK-P1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alma-pro', '{}', 6999, '73282932000074', 'Boulangerie Martin', 'adresse',
  'A', 'B', 'Gérant', 'a@b.fr', '+33600000000', 'X', 'FR', '0000', '\x00', 'RUM-P1', 'v', 't', repeat('a', 64), 's', now()),
       ('STK-P2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'alma-pro', '{}', 6999, '73282932000074', 'Garage du Pont', 'adresse',
  'A', 'B', 'Gérant', 'a@b.fr', '+33600000000', 'X', 'FR', '0000', '\x00', 'RUM-P2', 'v', 't', repeat('a', 64), 's', now());
delete from public.push_devices where stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select public.deal_record_payment(id, date '2026-11-01', 6999, 'tr_p') from public.deals where reference in ('STK-P1', 'STK-P2');
select is((select title || ' | ' || body || ' | ' || path from public.push_outbox where kind = 'commission'),
  'Commission débloquée | Boulangerie Martin a été prélevé : 10,49 € disponibles dans Gains. | /app/gains', 'client prélevé : notification de commission');
select is((select count(*)::int from public.push_outbox where stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 0, 'sans appareil : rien en file');

insert into public.payouts (stacker_id, amount_cents, iban_last4) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1049, '0189');
update public.payouts set status = 'verse', processed_at = now();
select is((select body from public.push_outbox where kind = 'virement'), '10,49 € sont en route vers ton compte ••0189.', 'virement envoyé : notifié');

select public.mail_account_save('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'gmail', 'alice@gmail.com', 'chiffre-' || repeat('x', 40));
select public.mail_account_error('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'invalid_grant');
select is((select title from public.push_outbox where kind = 'boite'), 'Campagne en pause', 'boîte à reconnecter : notifié');

-- ---------------------------------------------------------------- envoi
create temporary table t_next on commit drop as select public.push_next(10) as j;
select is(jsonb_array_length((select j from t_next)), 3, 'serveur : 3 notifications à envoyer');
select is(jsonb_array_length((select j from t_next) -> 0 -> 'tokens'), 2, '... avec les deux appareils de A');
select is(jsonb_array_length(public.push_next(10)), 0, 'verrouillées : pas d''envoi en double');
select public.push_result(((select j from t_next) -> 0 ->> 'id')::bigint, true, null, array[repeat('c', 64)]);
select ok((select sent_at is not null from public.push_outbox where id = ((select j from t_next) -> 0 ->> 'id')::bigint), 'résultat : envoyée');
select is((select count(*)::int from public.push_devices where stacker_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 1, 'jeton refusé par Apple : supprimé');
update public.push_outbox set created_at = now() - interval '3 days' where sent_at is null;
select is(jsonb_array_length(public.push_next(10)), 0, 'trop anciennes : abandonnées');

select * from finish();
rollback;
