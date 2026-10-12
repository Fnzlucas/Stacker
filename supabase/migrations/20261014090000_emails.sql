-- =============================================================================
-- Stacker — Lot 7 : emails transactionnels
--
-- File d'envoi (email_outbox) alimentée par la base, envoyée par l'Edge
-- Function email-run (Brevo, toutes les 5 minutes) :
--   * contrat_client / contrat_stacker : contrat signé (PDF joint) au client
--     et au stacker, dès la signature ;
--   * prenotification : le client est prévenu au moins 2 jours avant chaque
--     prélèvement SEPA (montant, date, RUM) — obligation SEPA, promise par le
--     contrat ;
--   * bienvenue : fin de l'inscription du stacker ;
--   * abonnement_refuse / abonnement_coupe : paiement de l'abonnement refusé,
--     puis abonnement terminé faute de paiement ;
--   * prelevement_refuse : le prélèvement d'un client a échoué (le stacker est
--     invité à le rappeler).
-- Les adresses des stackers ne sont PAS copiées dans la file : elles sont lues
-- au moment de l'envoi (un compte supprimé ne reçoit plus rien). Les lignes
-- envoyées sont purgées après 90 jours.
-- =============================================================================

create table public.email_outbox (
  id           bigint generated always as identity primary key,
  kind         text not null,
  dedupe_key   text not null unique,
  -- Destinataire stacker (emails qui lui sont adressés) ; supprimés avec son compte.
  stacker_id   uuid references public.profiles (id) on delete cascade,
  deal_id      uuid references public.deals (id) on delete cascade,
  -- Adresse du CLIENT (contrat, pré-notification) ; null = le stacker, lu à l'envoi.
  client_email text,
  data         jsonb not null default '{}'::jsonb,
  status       text not null default 'a_envoyer',
  attempts     integer not null default 0,
  send_after   timestamptz not null default now(),
  last_error   text,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  constraint email_outbox_kind check (kind in ('contrat_client', 'contrat_stacker', 'prenotification', 'bienvenue', 'abonnement_refuse', 'abonnement_coupe', 'prelevement_refuse')),
  constraint email_outbox_status check (status in ('a_envoyer', 'envoye', 'echoue', 'annule')),
  constraint email_outbox_target check (case when kind in ('contrat_client', 'prenotification') then client_email is not null and stacker_id is null and deal_id is not null
                                             else client_email is null and stacker_id is not null end)
);
create index email_outbox_due_idx on public.email_outbox (send_after) where status = 'a_envoyer';

revoke all on table public.email_outbox from public, anon, authenticated, service_role;
revoke all on sequence public.email_outbox_id_seq from public, anon, authenticated, service_role;
alter table public.email_outbox enable row level security;
alter table public.email_outbox force row level security;
create policy email_outbox_owner on public.email_outbox for all to postgres using (true) with check (true);

create function public.email_enqueue(p_kind text, p_dedupe text, p_stacker uuid, p_deal uuid, p_client_email text, p_data jsonb, p_send_after timestamptz default now())
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.email_outbox (kind, dedupe_key, stacker_id, deal_id, client_email, data, send_after)
  values (p_kind, left(p_dedupe, 200), p_stacker, p_deal, p_client_email, coalesce(p_data, '{}'::jsonb), coalesce(p_send_after, now()))
  on conflict (dedupe_key) do nothing;
$$;

-- -----------------------------------------------------------------------------
-- Déclencheurs
-- -----------------------------------------------------------------------------

-- Contrat signé : un exemplaire au client, un au stacker.
create function public.emails_on_deal_signed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.email_enqueue('contrat_client', 'contrat_client:' || new.id, null, new.id, new.contact_email, '{}'::jsonb);
  if new.stacker_id is not null then
    perform public.email_enqueue('contrat_stacker', 'contrat_stacker:' || new.id, new.stacker_id, new.id, null, '{}'::jsonb);
  end if;
  return null;
end;
$$;
create trigger deals_emails_signed after insert on public.deals for each row execute function public.emails_on_deal_signed();

-- Prélèvement d'un client refusé : le stacker est prévenu.
create function public.emails_on_deal_suspended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'suspendu' and old.status <> 'suspendu' and new.stacker_id is not null then
    perform public.email_enqueue('prelevement_refuse', 'prelevement_refuse:' || new.id || ':' || to_char(now(), 'YYYY-MM-DD'), new.stacker_id, new.id, null,
      jsonb_build_object('reason', new.end_reason));
  end if;
  return null;
end;
$$;
create trigger deals_emails_suspended after update of status on public.deals for each row execute function public.emails_on_deal_suspended();

-- Inscription terminée : bienvenue.
create function public.emails_on_onboarded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.onboarding_completed_at is not null and old.onboarding_completed_at is null then
    perform public.email_enqueue('bienvenue', 'bienvenue:' || new.id, new.id, null, null, '{}'::jsonb);
  end if;
  return null;
end;
$$;
create trigger profiles_emails_onboarded after update of onboarding_completed_at on public.profiles for each row execute function public.emails_on_onboarded();

-- Paiement mensuel de l'abonnement refusé.
create function public.emails_on_charge_failed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'echoue' and old.status = 'en_attente' and new.kind = 'mensuel' and new.stacker_id is not null then
    perform public.email_enqueue('abonnement_refuse', 'abonnement_refuse:' || new.id, new.stacker_id, null, null,
      jsonb_build_object('amount_cents', new.amount_cents,
                         'grace_until', (select (b.current_period_end + s.grace_days) from public.stacker_billing b, public.billing_settings s
                                         where b.stacker_id = new.stacker_id and s.id)));
  end if;
  return null;
end;
$$;
create trigger billing_charges_emails_failed after update of status on public.billing_charges for each row execute function public.emails_on_charge_failed();

-- Abonnement terminé faute de paiement (pas après une résiliation voulue).
create function public.emails_on_billing_ended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'resilie' and old.status in ('actif', 'impaye') and not new.cancel_at_period_end then
    perform public.email_enqueue('abonnement_coupe', 'abonnement_coupe:' || new.stacker_id || ':' || to_char(now(), 'YYYY-MM-DD'), new.stacker_id, null, null, '{}'::jsonb);
  end if;
  return null;
end;
$$;
create trigger stacker_billing_emails_ended after update of status on public.stacker_billing for each row execute function public.emails_on_billing_ended();

revoke all on function public.email_enqueue(text, text, uuid, uuid, text, jsonb, timestamptz), public.emails_on_deal_signed(), public.emails_on_deal_suspended(),
  public.emails_on_onboarded(), public.emails_on_charge_failed(), public.emails_on_billing_ended()
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Pré-notification SEPA
-- -----------------------------------------------------------------------------

-- Prélèvements prévus dans 3 à 6 jours (heure de Paris) : un email par deal et
-- par date. Lancé à chaque passage d'email-run : un passage manqué est rattrapé,
-- le client est toujours prévenu au moins 2 jours avant.
create function public.email_schedule_prenotifications()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := public.paris_today();
  v_count integer := 0;
  r record;
begin
  for r in
    select d.id, d.contact_email, d.monthly_price_cents, d.mandate_ref, d.reference, x.debit_on
    from public.deals d
    cross join lateral (
      select (d.first_debit_on + make_interval(months => n))::date as debit_on
      from generate_series(0, 240) n
      where (d.first_debit_on + make_interval(months => n))::date between v_today + 3 and v_today + 6
    ) x
    where d.mollie_status = 'fait' and d.status in ('signe', 'actif', 'suspendu') and d.first_debit_on is not null
  loop
    insert into public.email_outbox (kind, dedupe_key, stacker_id, deal_id, client_email, data)
    values ('prenotification', 'prenotification:' || r.id || ':' || r.debit_on, null, r.id, r.contact_email,
            jsonb_build_object('debit_on', r.debit_on, 'amount_cents', r.monthly_price_cents))
    on conflict (dedupe_key) do nothing;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Envoi (service_role)
-- -----------------------------------------------------------------------------

-- Prochains emails à envoyer, avec tout ce qu'il faut pour les rédiger.
create function public.email_next(p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  -- Rétention : les emails envoyés ou abandonnés ne sont gardés que 90 jours.
  delete from public.email_outbox where status <> 'a_envoyer' and created_at < now() - interval '90 days';
  -- Deal résilié ou annulé avant l'envoi d'une pré-notification : plus rien à annoncer.
  update public.email_outbox o set status = 'annule'
  from public.deals d
  where o.status = 'a_envoyer' and o.kind = 'prenotification' and d.id = o.deal_id and d.status in ('resilie', 'annule');

  with picked as (
    select o.id from public.email_outbox o
    where o.status = 'a_envoyer' and o.send_after <= now()
    order by o.send_after, o.id
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  ), bumped as (
    update public.email_outbox o
    set attempts = o.attempts + 1,
        -- Nouvel essai dans 15 min, 1 h, 4 h… ; abandon après 6 tentatives.
        send_after = now() + make_interval(mins => 15 * (4 ^ least(o.attempts, 4))::integer),
        status = case when o.attempts + 1 >= 6 then 'echoue' else o.status end
    from picked where o.id = picked.id
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'kind', b.kind,
    'to', coalesce(b.client_email, (select u.email from auth.users u where u.id = b.stacker_id)),
    'to_name', case when b.client_email is not null then nullif(btrim(concat_ws(' ', d.contact_first_name, d.contact_last_name)), '')
                    else nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') end,
    'data', b.data,
    'stacker', case when p.id is null then null else jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name) end,
    'deal', case when d.id is null then null else jsonb_build_object(
      'reference', d.reference, 'status', d.status, 'company_name', d.company_name, 'company_siret', d.company_siret,
      'contact_name', btrim(concat_ws(' ', d.contact_first_name, d.contact_last_name)),
      'offer_label', (d.offer_snapshot ->> 'brand') || ' · ' || (d.offer_snapshot ->> 'name'),
      'monthly_price_cents', d.monthly_price_cents, 'mandate_ref', d.mandate_ref,
      'iban_masked', d.iban_country || '•• •••• ' || d.iban_last4,
      'signed_at', d.signed_at, 'withdrawal_until', d.withdrawal_until,
      'first_debit_on', coalesce(d.first_debit_on, greatest((d.withdrawal_until at time zone 'Europe/Paris')::date + 1, public.paris_today() + 3)),
      'contract_text', case when b.kind in ('contrat_client', 'contrat_stacker') then d.contract_text end,
      'contract_sha256', case when b.kind in ('contrat_client', 'contrat_stacker') then d.contract_sha256 end,
      'signature_png', case when b.kind in ('contrat_client', 'contrat_stacker') then d.signature_png end) end
  ) order by b.send_after, b.id), '[]'::jsonb) into v_out
  from bumped b
  left join public.deals d on d.id = b.deal_id
  left join public.profiles p on p.id = coalesce(b.stacker_id, d.stacker_id);
  return v_out;
end;
$$;

create function public.email_result(p_id bigint, p_ok boolean, p_error text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.email_outbox
  set status = case when p_ok then 'envoye' when p_error = 'no_recipient' then 'annule' else status end,
      sent_at = case when p_ok then now() else sent_at end,
      last_error = case when p_ok then null else left(p_error, 200) end
  where id = p_id;
$$;

revoke all on function public.email_schedule_prenotifications(), public.email_next(integer), public.email_result(bigint, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.email_schedule_prenotifications(), public.email_next(integer), public.email_result(bigint, boolean, text) to service_role;
