-- Lot 3 bis : campagnes. Démarrage (conditions), réservation en bloc sans
-- recouvrement entre stackers, montée progressive, fenêtre et espacement
-- d'envoi, résultats (succès, échecs, boîte révoquée), arrêt, pause « sans
-- réponse », confidentialité du jeton de la boîte, moteur (requêtes, lieux,
-- contacts, budget).
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(63);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Alice"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@exemple.fr', now(), '{"adult_declared": true, "terms_version": "v1", "first_name": "Bob"}');
update public.profiles set onboarding_completed_at = now(), department = '30'
where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- 60 plombiers du Gard avec une adresse générique trouvée sur leur site.
select public.enrich_save_contact(
  jsonb_build_object('siret', '5' || lpad(i::text, 8, '0') || '00011', 'name', 'PLOMBERIE ' || i, 'naf', '43.22A', 'department', '30', 'city', 'NIMES'),
  'contact@plomberie' || i || '.fr', null, 'https://plomberie' || i || '.fr/contact')
from generate_series(1, 60) i;
select is((select count(*)::int from public.company_contacts), 60, 'enrich_save_contact : 60 contacts enregistrés');

-- ---------------------------------------------------------------- démarrage
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select throws_ok($$select public.campaign_start('30', 'batiment', 50, 'decouverte')$$, 'P0001', 'rules_required', 'sans les règles acceptées ⇒ rules_required');
select public.accept_prospecting_rules('2026-10-08');
select throws_ok($$select public.campaign_start('30', 'batiment', 50, 'decouverte')$$, 'P0001', 'profile_incomplete', 'sans nom de famille ⇒ profile_incomplete');
reset role;
update public.profiles set last_name = 'Martin' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select throws_ok($$select public.campaign_start('30', 'batiment', 50, 'decouverte')$$, 'P0001', 'mailbox_required', 'sans boîte connectée ⇒ mailbox_required');
reset role;
select public.mail_account_save('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'gmail', 'Alice.Martin@Gmail.com', 'chiffre-' || repeat('x', 40));
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';
select throws_ok($$select public.campaign_start('30', 'batiment', 900, 'decouverte')$$, '22023', 'invalid_target', 'volume au-delà du maximum ⇒ invalid_target');
select throws_ok($$select public.campaign_start('30', 'batiment', 50, 'inconnu')$$, '22023', 'unknown_template', 'modèle inconnu ⇒ unknown_template');
select lives_ok($$select public.campaign_start('30', 'batiment', 50, 'decouverte')$$, 'A lance une campagne de 50/jour');
select throws_ok($$select public.campaign_start('30', 'batiment', 30, 'decouverte')$$, 'P0001', 'campaign_exists', 'une seule campagne ouverte à la fois');
select is(public.my_campaign() -> 'mailbox' ->> 'email', 'alice.martin@gmail.com', 'my_campaign : boîte connectée (adresse en minuscules)');
select ok(not (public.my_campaign()::text like '%chiffre-%'), 'my_campaign ne renvoie JAMAIS le jeton de la boîte');
select is((public.my_campaign() -> 'campaign' ->> 'cap_today')::int, 10, 'montée progressive : 10 le premier jour (et non 50)');
select is((public.my_campaign() -> 'campaign' ->> 'available')::int, 60, '60 entreprises écrivables');
select throws_ok($$select * from public.mail_accounts$$, '42501', null, 'lecture directe des boîtes ⇒ refusée');
select throws_ok($$select * from public.campaigns$$, '42501', null, 'lecture directe des campagnes ⇒ refusée');
select throws_ok($$select * from public.company_contacts$$, '42501', null, 'lecture directe des contacts trouvés ⇒ refusée');
select throws_ok($$select public.campaign_fill_due()$$, '42501', null, 'remplir la file (service) ⇒ refusé au stacker');
select throws_ok($$select public.campaign_next_messages(10)$$, '42501', null, 'lire la file d''envoi (service) ⇒ refusé au stacker');
reset role;

-- ---------------------------------------------------------------- remplissage
select is(public.campaign_fill_due(), 10, 'remplissage du jour : 10 réservations + emails en file');
select is(public.campaign_fill_due(), 0, '... idempotent dans la journée');
select is((select count(*)::int from public.prospect_claims where campaign_id is not null and released_at is null), 10, '10 entreprises réservées en bloc pour A');
select is((select count(*)::int from public.prospect_emails where send_status = 'queued'), 10, '10 emails en file');
select ok((select bool_and(footer like '%/opposition?t=%' and footer like 'Alice Martin, apporteur%' and body like '%Bien cordialement,%Alice Martin%')
           from public.prospect_emails), 'chaque email porte signature, pied légal et lien d''opposition');
select ok((select bool_and(recipient like 'contact@plomberie%') from public.prospect_emails), 'destinataires = adresses génériques trouvées');

-- B lance aussi une campagne sur la même zone : aucune entreprise en commun.
update public.profiles set last_name = 'Durand' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select public.mail_account_save('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'outlook', 'bob@outlook.fr', 'chiffre-' || repeat('y', 40));
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select public.accept_prospecting_rules('2026-10-08');
select public.campaign_start('30', 'batiment', 30, 'decouverte');
reset role;
select is(public.campaign_fill_due(), 10, 'B : 10 autres entreprises');
select is((select count(distinct siret)::int from public.prospect_claims where campaign_id is not null and released_at is null), 20,
          'aucune entreprise écrite par deux stackers');

-- ---------------------------------------------------------------- envoi
select is(jsonb_array_length(public.campaign_next_messages(10, '2026-10-10 03:00+02')), 0, 'samedi 3 h : hors fenêtre, rien ne part');
create temporary table t_batch on commit drop as select public.campaign_next_messages(10, '2026-10-12 10:00+02') as b;
select is(jsonb_array_length((select b from t_batch)), 2, 'lundi 10 h : un email par stacker et par passage');
select ok((select b::text like '%chiffre-%' from t_batch), '... avec le jeton chiffré (pour l''Edge Function)');
select ok((select b::text like '%"from_name": "Alice Martin"%' and b::text like '%"from_name": "Bob Durand"%' from t_batch),
          '... et le nom du stacker pour l''en-tête From');
select is((select count(*)::int from public.prospect_emails where send_status = 'sending'), 2, '... verrouillés (sending)');
select is(jsonb_array_length(public.campaign_next_messages(10, '2026-10-12 10:00+02')), 0, 'déjà en cours : pas d''envoi en double');

select lives_ok($$select public.campaign_message_result(((select b from t_batch) -> 0 ->> 'id')::uuid, true, 'msg-1', null)$$, 'succès d''un envoi');
select is((select c.status::text from public.prospect_claims c join public.prospect_emails e on e.claim_id = c.id
           where e.id = ((select b from t_batch) -> 0 ->> 'id')::uuid), 'contacte', '... entreprise passée « contacté »');
select ok((select c.expires_at > now() + interval '20 days' from public.prospect_claims c join public.prospect_emails e on e.claim_id = c.id
           where e.id = ((select b from t_batch) -> 0 ->> 'id')::uuid), '... réservation portée à 21 jours');
select ok((select first_send_on is not null from public.mail_accounts a join public.prospect_emails e on e.stacker_id = a.stacker_id
           where e.id = ((select b from t_batch) -> 0 ->> 'id')::uuid), '... début de la montée progressive enregistré');
select is(jsonb_array_length(public.campaign_next_messages(10, '2026-10-12 10:01+02')) <= 1, true,
          'espacement : le stacker qui vient d''envoyer attend son tour');

-- Échecs : 3 essais puis abandon et libération.
select lives_ok($$select public.campaign_message_result(((select b from t_batch) -> 1 ->> 'id')::uuid, false, null, 'http_500')$$, 'échec 1 : remis en file');
select is((select send_status from public.prospect_emails where id = ((select b from t_batch) -> 1 ->> 'id')::uuid), 'queued', '... en file');
update public.prospect_emails set attempts = 3, send_status = 'sending' where id = ((select b from t_batch) -> 1 ->> 'id')::uuid;
select lives_ok($$select public.campaign_message_result(((select b from t_batch) -> 1 ->> 'id')::uuid, false, null, 'http_500')$$, 'échec au 3e essai');
select is((select send_status from public.prospect_emails where id = ((select b from t_batch) -> 1 ->> 'id')::uuid), 'failed', '... abandonné');
select ok((select c.released_at is not null from public.prospect_claims c join public.prospect_emails e on e.claim_id = c.id
           where e.id = ((select b from t_batch) -> 1 ->> 'id')::uuid), '... et l''entreprise libérée');

-- Limite du fournisseur (Gmail 429 / dailyLimitExceeded) : la boîte n'est PAS
-- à reconnecter, l'essai n'est pas consommé, la boîte est en pause.
create temporary table t_rl on commit drop as select public.campaign_next_messages(10, '2026-10-12 10:30+02') as b;
select lives_ok($$select public.campaign_message_result(((select b from t_rl) -> 0 ->> 'id')::uuid, false, null, 'rate_limited', false, 900)$$, 'limite d''envoi atteinte');
select is((select send_status || '/' || attempts from public.prospect_emails where id = ((select b from t_rl) -> 0 ->> 'id')::uuid), 'queued/0',
          '... email remis en file, essai non consommé');
select ok((select throttled_until between now() + interval '14 minutes' and now() + interval '16 minutes' from public.mail_accounts
           where stacker_id = ((select b from t_rl) -> 0 ->> 'stacker_id')::uuid), '... boîte en pause 15 minutes');
select is((select status from public.mail_accounts where stacker_id = ((select b from t_rl) -> 0 ->> 'stacker_id')::uuid), 'active',
          '... boîte toujours active (pas « à reconnecter »)');
select is(jsonb_array_length(public.campaign_next_messages(10, '2026-10-12 10:31+02')), 0, 'boîte en pause : rien ne part');
select public.mail_account_save(((select b from t_rl) -> 0 ->> 'stacker_id')::uuid, 'outlook', 'bob@outlook.fr', 'chiffre-' || repeat('z', 40));
select is((select throttled_until from public.mail_accounts where stacker_id = ((select b from t_rl) -> 0 ->> 'stacker_id')::uuid), null,
          'reconnexion de la boîte : pause levée');

-- Boîte révoquée : erreur visible, envoi suspendu, email gardé en file.
create temporary table t_b2 on commit drop as select public.campaign_next_messages(10, '2026-10-12 11:00+02') as b;
select lives_ok($$select public.campaign_message_result(((select b from t_b2) -> 0 ->> 'id')::uuid, false, null, 'invalid_grant', true)$$, 'jeton révoqué');
select is((select status from public.mail_accounts where stacker_id = ((select b from t_b2) -> 0 ->> 'stacker_id')::uuid), 'error', '... boîte en erreur');
select is((select send_status from public.prospect_emails where id = ((select b from t_b2) -> 0 ->> 'id')::uuid), 'queued', '... email remis en file');

-- ---------------------------------------------------------------- sans réponse, arrêt
update public.prospect_claims set expires_at = now() - interval '1 minute'
where id = (select e.claim_id from public.prospect_emails e where e.id = ((select b from t_batch) -> 0 ->> 'id')::uuid);
select ok(public.prospect_expire_due() >= 1, 'sans réponse sous 21 jours : réservation expirée');
select ok((select k.reason = 'sans_reponse' and k.until > now() + interval '89 days' from public.company_cooldowns k
           join public.prospect_claims c on left(c.siret, 9) = k.siren
           join public.prospect_emails e on e.claim_id = c.id
           where e.id = ((select b from t_batch) -> 0 ->> 'id')::uuid), '... entreprise en pause 90 jours pour tous');

set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';
select lives_ok($$select public.campaign_set_status('stopped')$$, 'B arrête sa campagne');
reset role;
select is((select count(*)::int from public.prospect_emails e join public.campaigns k on k.id = e.campaign_id
           where k.stacker_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and e.send_status = 'queued'), 0, '... ses emails en file sont annulés');

-- ---------------------------------------------------------------- montée progressive
select is(public.mail_warmup_cap(public.paris_today() - 10), 30, 'montée progressive : 30 par jour la 2e semaine');
select is(public.mail_warmup_cap(public.paris_today() - 25), 500, '... puis le plafond global décide');

-- ---------------------------------------------------------------- moteur
select ok(public.enrich_query_begin('30|batiment|nimes|plombier', '30', 'batiment'), 'requête jamais jouée : on la joue');
select ok(not public.enrich_query_begin('30|batiment|nimes|plombier', '30', 'batiment'), 'requête déjà jouée : on ne repaie pas');
select public.enrich_mark_seen('ChIJ-place-0001', null, 'no_site');
select is(public.enrich_unseen(array['ChIJ-place-0001', 'ChIJ-place-0002']), array['ChIJ-place-0002'], 'lieux déjà traités ignorés');
select public.enrich_query_cancel('30|batiment|nimes|plombier');
select ok(public.enrich_query_begin('30|batiment|nimes|plombier', '30', 'batiment'), 'requête Google non aboutie : rejouable tout de suite');
select public.enrich_mark_seen('ChIJ-place-0003', null, 'error');
select is(public.enrich_unseen(array['ChIJ-place-0003']), '{}'::text[], 'lieu en erreur passagère : pas retenté le jour même');
update public.places_seen set seen_at = now() - interval '2 days' where place_id = 'ChIJ-place-0003';
select is(public.enrich_unseen(array['ChIJ-place-0003']), array['ChIJ-place-0003'], '... mais retenté le lendemain');
update public.prospect_settings set places_monthly_budget_usd = 1;
select ok(public.budget_consume('places', 900000) and not public.budget_consume('places', 200000), 'budget Google : plafond mensuel respecté');

select * from finish();
rollback;
