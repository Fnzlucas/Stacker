-- =============================================================================
-- Stacker — Lot 6 : paiements Mollie
--
--   1. Abonnement stacker (6,99 €/mois par défaut) :
--      * premier paiement par carte sur la page Mollie (crée un mandat) ;
--      * chaque mois ensuite : prélevé sur le solde de commissions disponible
--        s'il suffit (ligne « abonnement » négative), sinon débité sur le
--        mandat Mollie (paiement récurrent) ;
--      * les 100 premiers (et les inscrits prioritaires de la liste d'attente)
--        gardent le tarif de lancement et 0 % prélevé pendant 12 mois ;
--      * sans abonnement à jour (après 3 jours de grâce) : plus de réservation,
--        de recherche, de campagne ni de signature ; la campagne est mise en
--        pause. Interrupteur global app_flags.billing_required (désactivé tant
--        que Mollie n'est pas configuré).
--   2. Prélèvement des clients signés : client, mandat SEPA (IBAN, RUM et
--      date de signature du contrat) et abonnement mensuel Mollie, premier
--      prélèvement le lendemain de la fin du délai de rétractation. Chaque
--      paiement confirmé crée la commission (deal_record_payment) ; un échec
--      suspend le deal ; un remboursement (8 semaines) crée une REPRISE de la
--      commission, déduite du solde.
--   Les appels à Mollie sont faits par les Edge Functions (billing-checkout,
--   mollie-webhook, mollie-run) ; la base ne fait que tenir l'état.
-- =============================================================================

insert into public.app_flags (key, enabled) values ('billing_required', false);

create table public.billing_settings (
  id               boolean primary key default true,
  price_cents      integer not null default 699,
  launch_seats     integer not null default 100,
  launch_months    integer not null default 12,
  grace_days       integer not null default 3,
  -- Part prélevée par Stacker sur les commissions (0 % pour les membres du lancement).
  standard_fee_bps integer not null default 0,
  updated_at       timestamptz not null default now(),
  constraint billing_settings_singleton check (id),
  constraint billing_settings_bounds check (price_cents between 100 and 100000 and launch_seats between 0 and 100000
    and launch_months between 0 and 60 and grace_days between 0 and 30 and standard_fee_bps between 0 and 5000)
);
insert into public.billing_settings default values;

create table public.stacker_billing (
  stacker_id          uuid primary key references public.profiles (id) on delete cascade,
  status              text not null default 'aucun',
  mollie_customer_id  text,
  mollie_mandate_id   text,
  method_label        text,
  launch_member       boolean not null default false,
  launch_until        date,
  current_period_end  date,
  -- Résiliation demandée par le stacker : accès jusqu'à la fin de la période payée, puis plus de renouvellement.
  cancel_at_period_end boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint stacker_billing_status check (status in ('aucun', 'en_attente', 'actif', 'impaye', 'resilie'))
);

create table public.billing_charges (
  id                 bigint generated always as identity primary key,
  stacker_id         uuid references public.profiles (id) on delete set null,
  kind               text not null,
  period_start       date not null,
  amount_cents       integer not null,
  method             text not null,
  status             text not null default 'en_attente',
  mollie_payment_id  text unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint billing_charges_kind check (kind in ('premier', 'mensuel')),
  constraint billing_charges_method check (method in ('mollie', 'commissions')),
  constraint billing_charges_status check (status in ('en_attente', 'paye', 'echoue')),
  constraint billing_charges_amount check (amount_cents > 0)
);
create unique index billing_charges_one_period on public.billing_charges (stacker_id, period_start) where status <> 'echoue';

-- Deals : suivi Mollie (client, mandat, abonnement) et annulations à transmettre.
alter table public.deals
  add column mollie_customer_id     text,
  add column mollie_mandate_id      text,
  add column mollie_subscription_id text unique,
  add column mollie_status          text not null default 'a_faire',
  add column mollie_error           text,
  add column mollie_attempts        integer not null default 0,
  add column first_debit_on         date,
  add constraint deals_mollie_status check (mollie_status in ('a_faire', 'fait', 'erreur', 'a_annuler', 'annule'));

-- Paiements remboursés (contestation du client) : jamais supprimés.
alter table public.deal_payments
  add column reversed_at timestamptz;

-- Commissions : lignes de reprise (remboursement) et d'abonnement payé par les gains, négatives.
alter table public.commission_entries
  add column kind text not null default 'commission',
  alter column payment_id drop not null,
  alter column deal_id drop not null,
  drop constraint commission_entries_amount,
  add constraint commission_entries_kind check (kind in ('commission', 'reprise', 'abonnement')),
  add constraint commission_entries_amount check ((kind = 'commission' and amount_cents >= 0 and payment_id is not null and deal_id is not null)
    or (kind = 'reprise' and amount_cents <= 0 and deal_id is not null)
    or (kind = 'abonnement' and amount_cents < 0));
alter table public.commission_entries drop constraint commission_entries_payment_id_key;
create unique index commission_entries_payment_once on public.commission_entries (payment_id, kind) where payment_id is not null;

-- Contrat : pré-notification des prélèvements (au moins 2 jours avant, règle SEPA Core).
update public.deal_settings
set contract_template = replace(contract_template, 'Type de paiement : récurrent.',
      'Type de paiement : récurrent, mensuel.' || chr(10) ||
      'Pré-notification : le présent contrat vaut information préalable du montant mensuel prélevé. Le Client est en outre prévenu par email au moins 2 jours avant chaque prélèvement, avec son montant et sa date.'),
    contract_version = '2026-10-13'
where id;

revoke all on table public.billing_settings, public.stacker_billing, public.billing_charges from public, anon, authenticated, service_role;
revoke all on sequence public.billing_charges_id_seq from public, anon, authenticated, service_role;
alter table public.billing_settings enable row level security;
alter table public.billing_settings force row level security;
alter table public.stacker_billing enable row level security;
alter table public.stacker_billing force row level security;
alter table public.billing_charges enable row level security;
alter table public.billing_charges force row level security;
create policy billing_settings_owner on public.billing_settings for all to postgres using (true) with check (true);
create policy stacker_billing_owner on public.stacker_billing for all to postgres using (true) with check (true);
create policy billing_charges_owner on public.billing_charges for all to postgres using (true) with check (true);

-- -----------------------------------------------------------------------------
-- Accès
-- -----------------------------------------------------------------------------

create function public.stacker_has_access(p_stacker uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public.app_flag('billing_required') or exists (
    select 1 from public.stacker_billing b, public.billing_settings s
    where b.stacker_id = p_stacker and s.id and b.status in ('actif', 'impaye')
      and case when b.cancel_at_period_end then b.current_period_end > public.paris_today()
               else b.current_period_end + s.grace_days >= public.paris_today() end);
$$;

create function public.require_subscription(p_stacker uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.stacker_has_access(p_stacker) then
    raise exception 'subscription_required' using errcode = 'P0001';
  end if;
end;
$$;

-- Solde de commissions disponible (délai passé), lignes négatives incluses.
create function public.available_balance(p_stacker uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(e.amount_cents), 0)::integer from public.commission_entries e
  where e.stacker_id = p_stacker and e.status = 'disponible' and e.available_at <= now();
$$;

-- -----------------------------------------------------------------------------
-- Stacker : état de l'abonnement
-- -----------------------------------------------------------------------------

create function public.my_billing()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s public.billing_settings%rowtype;
  b public.stacker_billing%rowtype;
  v_taken integer;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select * into s from public.billing_settings where id;
  select * into b from public.stacker_billing x where x.stacker_id = v_uid;
  select count(*) into v_taken from public.stacker_billing x where x.launch_member;
  return jsonb_build_object(
    'required', public.app_flag('billing_required'),
    'has_access', public.stacker_has_access(v_uid),
    'status', coalesce(b.status, 'aucun'),
    'price_cents', s.price_cents,
    'launch_member', coalesce(b.launch_member, false),
    'launch_until', b.launch_until,
    'launch_seats_left', greatest(s.launch_seats - v_taken, 0),
    'launch_priority', coalesce((select p.launch_priority from public.profiles p where p.id = v_uid), false),
    'current_period_end', b.current_period_end,
    'method_label', b.method_label,
    'cancel_at_period_end', coalesce(b.cancel_at_period_end, false),
    'charges', coalesce((select jsonb_agg(jsonb_build_object('period_start', c.period_start, 'amount_cents', c.amount_cents, 'method', c.method,
                                                             'status', c.status, 'created_at', c.created_at) order by c.created_at desc)
                         from (select * from public.billing_charges c where c.stacker_id = v_uid order by c.created_at desc limit 24) c), '[]'::jsonb)
  );
end;
$$;

-- Résilier (ou reprendre) son abonnement : effet à la fin de la période déjà payée.
create function public.billing_set_auto_renew(p_on boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  update public.stacker_billing set cancel_at_period_end = not p_on, updated_at = now()
  where stacker_id = v_uid and status in ('actif', 'impaye');
  if not found then
    raise exception 'no_subscription' using errcode = 'P0002';
  end if;
  return public.my_billing();
end;
$$;

-- -----------------------------------------------------------------------------
-- Serveur : abonnement stacker
-- -----------------------------------------------------------------------------

-- Avant le paiement Mollie : renvoie de quoi créer le client et le premier paiement.
create function public.billing_checkout_prepare(p_stacker uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.profiles%rowtype;
  b public.stacker_billing%rowtype;
begin
  select * into p from public.profiles x where x.id = p_stacker;
  if not found or p.onboarding_completed_at is null then
    raise exception 'onboarding_required' using errcode = 'P0001';
  end if;
  insert into public.stacker_billing (stacker_id) values (p_stacker) on conflict (stacker_id) do nothing;
  select * into b from public.stacker_billing x where x.stacker_id = p_stacker for update;
  if b.status = 'actif' and b.current_period_end >= public.paris_today() then
    raise exception 'already_active' using errcode = 'P0001';
  end if;
  if b.status in ('aucun', 'resilie') then
    update public.stacker_billing set status = 'en_attente', cancel_at_period_end = false, updated_at = now() where stacker_id = p_stacker;
  end if;
  return jsonb_build_object(
    'customer_id', b.mollie_customer_id,
    'name', nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    'email', (select u.email from auth.users u where u.id = p_stacker),
    'amount_cents', (select s.price_cents from public.billing_settings s where s.id),
    'period_start', public.paris_today()
  );
end;
$$;

create function public.billing_set_customer(p_stacker uuid, p_customer text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.stacker_billing set mollie_customer_id = left(p_customer, 64), updated_at = now() where stacker_id = p_stacker;
$$;

create function public.billing_charge_created(p_stacker uuid, p_kind text, p_period date, p_amount integer, p_payment text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_kind not in ('premier', 'mensuel') or exists (select 1 from public.billing_charges c where c.mollie_payment_id = p_payment) then
    return;
  end if;
  -- Un nouveau paiement remplace celui resté en attente pour la même période (page Mollie rouverte).
  update public.billing_charges set status = 'echoue', updated_at = now()
  where stacker_id = p_stacker and period_start = p_period and status = 'en_attente' and method = 'mollie';
  insert into public.billing_charges (stacker_id, kind, period_start, amount_cents, method, mollie_payment_id)
  values (p_stacker, p_kind, p_period, p_amount, 'mollie', left(p_payment, 64))
  on conflict do nothing;
end;
$$;

-- Paiement d'abonnement confirmé par Mollie (premier ou mensuel). Idempotent.
create function public.billing_payment_paid(p_payment text, p_mandate text, p_method_label text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c public.billing_charges%rowtype;
  s public.billing_settings%rowtype;
  b public.stacker_billing%rowtype;
  v_launch boolean;
begin
  select * into c from public.billing_charges x where x.mollie_payment_id = p_payment for update;
  if not found or c.status = 'paye' or c.stacker_id is null then
    return;
  end if;
  select * into s from public.billing_settings where id;
  select * into b from public.stacker_billing x where x.stacker_id = c.stacker_id for update;
  -- Paiement remplacé mais payé quand même, ou payé deux fois : il couvre le mois suivant.
  update public.billing_charges set status = 'echoue', updated_at = now()
  where stacker_id = c.stacker_id and period_start = c.period_start and status = 'en_attente' and id <> c.id;
  while exists (select 1 from public.billing_charges x where x.stacker_id = c.stacker_id and x.period_start = c.period_start and x.status = 'paye') loop
    c.period_start := (greatest(c.period_start, coalesce(b.current_period_end, c.period_start)) + case when b.current_period_end > c.period_start then interval '0' else interval '1 month' end)::date;
  end loop;
  update public.billing_charges set status = 'paye', period_start = c.period_start, updated_at = now() where id = c.id;
  v_launch := b.launch_member;
  if c.kind = 'premier' and not b.launch_member then
    -- Place de lancement : prioritaires de la liste d'attente, puis les premiers à payer.
    v_launch := coalesce((select p.launch_priority from public.profiles p where p.id = c.stacker_id), false)
             or (select count(*) from public.stacker_billing x where x.launch_member) < s.launch_seats;
  end if;
  update public.stacker_billing
  set status = 'actif',
      mollie_mandate_id = coalesce(left(p_mandate, 64), mollie_mandate_id),
      method_label = coalesce(left(p_method_label, 60), method_label),
      launch_member = v_launch,
      launch_until = case when v_launch and launch_until is null then (public.paris_today() + make_interval(months => s.launch_months))::date else launch_until end,
      current_period_end = (greatest(coalesce(current_period_end, c.period_start), c.period_start) + interval '1 month')::date,
      updated_at = now()
  where stacker_id = c.stacker_id;
end;
$$;

create function public.billing_payment_failed(p_payment text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c public.billing_charges%rowtype;
begin
  select * into c from public.billing_charges x where x.mollie_payment_id = p_payment for update;
  if not found or c.status <> 'en_attente' then
    return;
  end if;
  update public.billing_charges set status = 'echoue', updated_at = now() where id = c.id;
  update public.stacker_billing
  set status = case when c.kind = 'premier' and status = 'en_attente' then 'aucun' when c.kind = 'mensuel' then 'impaye' else status end,
      updated_at = now()
  where stacker_id = c.stacker_id;
end;
$$;

-- Renouvellements dus : payés sur les commissions si possible (immédiat), sinon
-- renvoyés pour un prélèvement sur le mandat Mollie. Fin de grâce dépassée :
-- abonnement résilié et campagne mise en pause.
create function public.billing_renew_due(p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.billing_settings%rowtype;
  b record;
  v_out jsonb := '[]'::jsonb;
begin
  select * into s from public.billing_settings where id;
  update public.stacker_billing x set status = 'resilie', updated_at = now()
  where x.status in ('actif', 'impaye')
    and (x.current_period_end + s.grace_days < public.paris_today() or (x.cancel_at_period_end and x.current_period_end <= public.paris_today()));
  update public.campaigns k set status = 'paused', updated_at = now()
  where k.status = 'active' and public.app_flag('billing_required') and not public.stacker_has_access(k.stacker_id);

  for b in
    select x.* from public.stacker_billing x
    where x.status = 'actif' and x.current_period_end <= public.paris_today() and not x.cancel_at_period_end
      and not exists (select 1 from public.billing_charges c where c.stacker_id = x.stacker_id and c.period_start = x.current_period_end and c.status <> 'echoue')
    order by x.current_period_end
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  loop
    if public.available_balance(b.stacker_id) >= s.price_cents then
      insert into public.billing_charges (stacker_id, kind, period_start, amount_cents, method, status)
      values (b.stacker_id, 'mensuel', b.current_period_end, s.price_cents, 'commissions', 'paye');
      insert into public.commission_entries (stacker_id, period, client_amount_cents, rate_bps, amount_cents, kind, available_at)
      values (b.stacker_id, b.current_period_end, 0, 0, -s.price_cents, 'abonnement', now());
      update public.stacker_billing set current_period_end = (current_period_end + interval '1 month')::date, updated_at = now()
      where stacker_id = b.stacker_id;
    elsif b.mollie_customer_id is not null and b.mollie_mandate_id is not null then
      v_out := v_out || jsonb_build_object('stacker_id', b.stacker_id, 'customer_id', b.mollie_customer_id, 'mandate_id', b.mollie_mandate_id,
                                           'period_start', b.current_period_end, 'amount_cents', s.price_cents);
    else
      update public.stacker_billing set status = 'impaye', updated_at = now() where stacker_id = b.stacker_id;
    end if;
  end loop;
  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- Serveur : prélèvement des clients
-- -----------------------------------------------------------------------------

-- Deals signés à déclarer à Mollie (IBAN déchiffré, réservé au serveur).
create function public.deal_mollie_pending(p_limit integer)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with picked as (
    select d.id from public.deals d
    where d.mollie_status = 'a_faire' and d.status in ('signe', 'actif') and d.mollie_attempts < 8
    order by d.signed_at limit greatest(1, least(p_limit, 100))
    for update skip locked
  ), bumped as (
    update public.deals d set mollie_attempts = d.mollie_attempts + 1
    from picked where d.id = picked.id
    returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', b.id, 'reference', b.reference, 'customer_id', b.mollie_customer_id, 'mandate_id', b.mollie_mandate_id,
    'company_name', b.company_name, 'email', b.contact_email,
    'iban', extensions.pgp_sym_decrypt(b.iban_enc, public.iban_key()), 'iban_holder', b.iban_holder,
    'mandate_ref', b.mandate_ref, 'signed_on', (b.signed_at at time zone 'Europe/Paris')::date,
    'first_debit_on', greatest((b.withdrawal_until at time zone 'Europe/Paris')::date + 1, public.paris_today() + 3),
    'amount_cents', b.monthly_price_cents)), '[]'::jsonb)
  from bumped b;
$$;

-- Progression de la mise en place : client et mandat créés, puis abonnement.
create function public.deal_mollie_progress(p_deal uuid, p_customer text, p_mandate text, p_subscription text, p_first_debit date)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.deals
  set mollie_customer_id = coalesce(left(p_customer, 64), mollie_customer_id),
      mollie_mandate_id = coalesce(left(p_mandate, 64), mollie_mandate_id),
      mollie_subscription_id = coalesce(left(p_subscription, 64), mollie_subscription_id),
      first_debit_on = coalesce(p_first_debit, first_debit_on),
      mollie_status = case when p_subscription is not null then 'fait' else mollie_status end,
      mollie_error = case when p_subscription is not null then null else mollie_error end,
      updated_at = now()
  where id = p_deal;
$$;

create function public.deal_mollie_failed(p_deal uuid, p_error text, p_final boolean)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.deals
  set mollie_error = left(p_error, 200), mollie_status = case when p_final then 'erreur' else mollie_status end, updated_at = now()
  where id = p_deal;
$$;

-- Abonnements Mollie à arrêter (contrat résilié ou annulé).
create function public.deal_mollie_cancels(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('deal_id', d.id, 'customer_id', d.mollie_customer_id, 'subscription_id', d.mollie_subscription_id)), '[]'::jsonb)
  from (select * from public.deals d where d.mollie_status = 'a_annuler' order by d.updated_at limit greatest(1, least(p_limit, 100))) d;
$$;

create function public.deal_mollie_cancelled(p_deal uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.deals set mollie_status = 'annule', updated_at = now() where id = p_deal and mollie_status = 'a_annuler';
$$;

-- Paiement d'un client confirmé par Mollie (via l'abonnement du deal).
create function public.deal_payment_from_mollie(p_subscription text, p_paid_on date, p_amount_cents integer, p_payment text)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deal uuid;
begin
  select d.id into v_deal from public.deals d where d.mollie_subscription_id = p_subscription;
  if v_deal is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return public.deal_record_payment(v_deal, p_paid_on, p_amount_cents, p_payment);
end;
$$;

-- Prélèvement d'un client échoué : deal suspendu (le stacker est invité à rappeler).
create function public.deal_payment_failed_from_mollie(p_subscription text, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d public.deals%rowtype;
begin
  select * into d from public.deals x where x.mollie_subscription_id = p_subscription for update;
  if not found or d.status in ('resilie', 'annule', 'suspendu') then
    return;
  end if;
  update public.deals set status = 'suspendu', end_reason = left('prélèvement refusé : ' || coalesce(p_reason, 'inconnu'), 300), updated_at = now() where id = d.id;
  if d.stacker_id is not null then
    perform public.deal_refresh_active_clients(d.stacker_id);
  end if;
end;
$$;

-- Remboursement (contestation) d'un paiement client : reprise de la commission.
create function public.deal_payment_reversed(p_payment text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.deal_payments%rowtype;
  e public.commission_entries%rowtype;
begin
  select * into p from public.deal_payments x where x.provider_ref = p_payment for update;
  if not found or p.reversed_at is not null then
    return;
  end if;
  update public.deal_payments set reversed_at = now() where id = p.id;
  select * into e from public.commission_entries x where x.payment_id = p.id and x.kind = 'commission';
  if found and e.amount_cents > 0 then
    if e.status = 'disponible' then
      -- Pas encore versée : simplement annulée (ligne de reprise du même montant, au même moment).
      insert into public.commission_entries (stacker_id, deal_id, payment_id, period, client_amount_cents, rate_bps, amount_cents, kind, available_at)
      values (e.stacker_id, e.deal_id, p.id, e.period, -p.amount_cents, e.rate_bps, -e.amount_cents, 'reprise', e.available_at);
    else
      -- Déjà demandée ou versée : déduite du solde suivant.
      insert into public.commission_entries (stacker_id, deal_id, payment_id, period, client_amount_cents, rate_bps, amount_cents, kind, available_at)
      values (e.stacker_id, e.deal_id, p.id, e.period, -p.amount_cents, e.rate_bps, -e.amount_cents, 'reprise', now());
    end if;
  end if;
  perform public.deal_payment_failed_from_mollie(
    (select d.mollie_subscription_id from public.deals d where d.id = p.deal_id), 'paiement contesté par le client');
end;
$$;

-- Résiliation ou annulation : l'abonnement Mollie du client doit être arrêté.
create function public.deals_mollie_cancel_mark()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('resilie', 'annule') and old.status not in ('resilie', 'annule') then
    new.mollie_status := case when new.mollie_subscription_id is not null then 'a_annuler' when new.mollie_status = 'a_faire' then 'annule' else new.mollie_status end;
  end if;
  return new;
end;
$$;
revoke all on function public.deals_mollie_cancel_mark() from public, anon, authenticated, service_role;
create trigger deals_mollie_cancel before update of status on public.deals for each row execute function public.deals_mollie_cancel_mark();

-- -----------------------------------------------------------------------------
-- Abonnement exigé pour les actions de prospection et de vente
-- -----------------------------------------------------------------------------
create or replace function public.prospect_claim(p_siret text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := public.prospect_require_stacker();
  s       public.prospect_settings%rowtype;
  v_siren text;
  v_id    uuid;
begin
  perform public.require_subscription(v_uid);
  if p_siret is null or p_siret !~ '^[0-9]{14}$' then
    raise exception 'invalid_siret' using errcode = '22023';
  end if;
  select * into s from public.prospect_settings;
  if not exists (select 1 from public.companies c where c.siret = p_siret) then
    raise exception 'unknown_company' using errcode = 'P0002';
  end if;
  v_siren := left(p_siret, 9);
  perform public.prospect_expire_due(null, p_siret);
  perform public.prospect_expire_due(v_uid, null);
  if public.is_opposed(v_siren, null, null) then
    raise exception 'opposed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.company_cooldowns k where k.siren = v_siren and k.until > now()) then
    raise exception 'cooldown' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.prospect_claims c where c.siret = p_siret and c.released_at is null) then
    raise exception 'already_claimed' using errcode = 'P0001';
  end if;
  if (select count(*) from public.prospect_claims c
      where c.siret = p_siret and c.claimed_at > now() - interval '12 months') >= s.max_claims_per_company_12m then
    raise exception 'company_quota' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.prospect_claims c
             where c.siret = p_siret and c.stacker_id = v_uid and c.release_reason in ('expire', 'manuel')
               and c.released_at > now() - make_interval(days => s.reclaim_block_days)) then
    raise exception 'reclaim_blocked' using errcode = 'P0001';
  end if;
  if (select count(*) from public.prospect_claims c
      where c.stacker_id = v_uid and c.released_at is null and c.status <> 'signe' and c.campaign_id is null) >= s.max_active_claims then
    raise exception 'max_active' using errcode = 'P0001';
  end if;
  perform public.usage_consume(v_uid, 'claim', s.max_new_claims_per_day, null);
  begin
    insert into public.prospect_claims (stacker_id, siret, expires_at)
    values (v_uid, p_siret, now() + make_interval(days => s.claim_ttl_days))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'already_claimed' using errcode = 'P0001';
  end;
  perform public.prospect_log(v_id, v_uid, 'reserve');
  return v_id;
end;
$$;

create or replace function public.campaign_start(p_department text, p_preset text, p_daily_target integer, p_template_key text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.prospect_require_stacker();
  p     public.profiles%rowtype;
  v_id  uuid;
begin
  perform public.require_subscription(v_uid);
  if not public.app_flag('campaigns_enabled') then
    raise exception 'disabled' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.user_consents c where c.user_id = v_uid and c.purpose = 'prospecting_rules') then
    raise exception 'rules_required' using errcode = 'P0001';
  end if;
  select * into p from public.profiles x where x.id = v_uid;
  if p.first_name is null or p.last_name is null then
    raise exception 'profile_incomplete' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.mail_accounts a where a.stacker_id = v_uid and a.status = 'active') then
    raise exception 'mailbox_required' using errcode = 'P0001';
  end if;
  if p_daily_target is null or p_daily_target < 10 or p_daily_target > (select s.campaign_max_per_day from public.prospect_settings s) then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if not exists (select 1 from public.email_templates t where t.key = p_template_key and t.active) then
    raise exception 'unknown_template' using errcode = '22023';
  end if;
  if not exists (select 1 from public.naf_presets n where n.key = p_preset) then
    raise exception 'unknown_preset' using errcode = '22023';
  end if;
  begin
    insert into public.campaigns (stacker_id, department, preset, daily_target, template_key)
    values (v_uid, p_department, p_preset, p_daily_target, p_template_key)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'campaign_exists' using errcode = 'P0001';
  end;
  return v_id;
end;
$$;

create or replace function public.campaign_set_status(p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.prospect_require_stacker();
  k     public.campaigns%rowtype;
  v_id  uuid;
begin
  if p_status = 'active' then
    perform public.require_subscription((select auth.uid()));
  end if;
  if p_status not in ('active', 'paused', 'stopped') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select * into k from public.campaigns x where x.stacker_id = v_uid and x.status <> 'stopped' for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.campaigns set status = p_status, updated_at = now() where id = k.id;
  if p_status = 'stopped' then
    for v_id in
      select c.id from public.prospect_claims c
      where c.campaign_id = k.id and c.released_at is null and c.status = 'a_contacter'
    loop
      perform public.prospect_release_internal(v_id, 'manuel');
    end loop;
  end if;
end;
$$;

create or replace function public.prospects_search_begin(p_user uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limit integer := (select s.searches_per_day from public.prospect_settings s);
  v_used  integer;
begin
  if not public.app_flag('prospects_enabled') then
    raise exception 'disabled' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.onboarding_completed_at is not null) then
    raise exception 'onboarding_required' using errcode = 'P0001';
  end if;
  perform public.require_subscription(p_user);
  v_used := public.usage_consume(p_user, 'search', v_limit, null);
  return jsonb_build_object('used', v_used, 'limit', v_limit);
end;
$$;

create or replace function public.deal_preview(p_input jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.deal_require_stacker();
  v jsonb := public.deal_validate(p_input, false);
  v_refs text[] := public.deal_preview_refs(v, v_uid);
  v_text text := public.deal_render_contract(v, v_refs[1], v_refs[2], v_uid);
  v_rate integer := public.deal_rate_bps(v_uid);
begin
  perform public.require_subscription(v_uid);
  return jsonb_build_object(
    'reference', v_refs[1], 'mandate_ref', v_refs[2],
    'contract_text', v_text, 'contract_sha256', encode(extensions.digest(v_text, 'sha256'), 'hex'),
    'monthly_price_cents', (v ->> 'monthly_price_cents')::integer,
    'rate_bps', v_rate,
    'commission_cents', ((v ->> 'monthly_price_cents')::integer * v_rate) / 10000
  );
end;
$$;

create or replace function public.deal_sign(p_input jsonb, p_signature text, p_contract_sha256 text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.deal_require_stacker();
  s public.deal_settings%rowtype;
  v jsonb;
  v_refs text[];
  v_text text;
  v_sha text;
  v_claim uuid;
  v_id uuid;
  v_rate integer;
begin
  perform public.require_subscription(v_uid);
  select * into s from public.deal_settings where id;
  if (select count(*) from public.deals d where d.stacker_id = v_uid and d.created_at >= now() - interval '24 hours') >= s.max_deals_per_day then
    raise exception 'daily_quota' using errcode = '54000';
  end if;
  v := public.deal_validate(p_input, true);
  if p_signature is null or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$'
     or char_length(p_signature) not between 1500 and 400000 then
    raise exception 'invalid_signature' using errcode = '22023';
  end if;
  v_refs := public.deal_preview_refs(v, v_uid);
  if exists (select 1 from public.deals d where d.reference = v_refs[1] or d.mandate_ref = v_refs[2]) then
    raise exception 'already_signed' using errcode = '23505';
  end if;
  v_text := public.deal_render_contract(v, v_refs[1], v_refs[2], v_uid);
  v_sha := encode(extensions.digest(v_text, 'sha256'), 'hex');
  if p_contract_sha256 is distinct from v_sha then
    raise exception 'contract_changed' using errcode = '40001';
  end if;
  if v ->> 'claim_id' is not null then
    begin
      v_claim := (v ->> 'claim_id')::uuid;
    exception when others then
      raise exception 'not_found' using errcode = 'P0002';
    end;
    if not exists (select 1 from public.prospect_claims c where c.id = v_claim and c.stacker_id = v_uid and c.released_at is null and c.status <> 'signe') then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.deals (
    reference, stacker_id, claim_id, offer_id, offer_snapshot, quantity, monthly_price_cents,
    company_siret, company_name, company_address, contact_first_name, contact_last_name, contact_role, contact_email, contact_phone,
    iban_holder, iban_country, iban_last4, iban_enc, mandate_ref,
    contract_version, contract_text, contract_sha256, signature_png, signer_ip, signer_ua, withdrawal_until
  ) values (
    v_refs[1], v_uid, v_claim, v -> 'offer' ->> 'id', v -> 'offer', (v ->> 'quantity')::integer, (v ->> 'monthly_price_cents')::integer,
    v ->> 'siret', v ->> 'company_name', v ->> 'company_address', v ->> 'first_name', v ->> 'last_name', v ->> 'role', v ->> 'email', v ->> 'phone',
    v ->> 'iban_holder', left(v ->> 'iban', 2), right(v ->> 'iban', 4),
    extensions.pgp_sym_encrypt(v ->> 'iban', public.iban_key()), v_refs[2],
    s.contract_version, v_text, v_sha, p_signature,
    public.request_header('x-forwarded-for'), public.request_header('user-agent'),
    now() + make_interval(days => s.withdrawal_days)
  ) returning id into v_id;

  if v_claim is not null then
    perform public.prospect_mark_signed(v_claim, v_refs[1]);
  end if;

  v_rate := public.deal_rate_bps(v_uid);
  return jsonb_build_object(
    'id', v_id, 'reference', v_refs[1],
    'monthly_price_cents', (v ->> 'monthly_price_cents')::integer,
    'rate_bps', v_rate,
    'commission_cents', ((v ->> 'monthly_price_cents')::integer * v_rate) / 10000
  );
end;
$$;


-- Export RGPD : abonnement et paiements d'abonnement.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_out jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'format', 'stacker-export-v1',
    'exported_at', now(),
    'account', (
      select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'email_confirmed_at', u.email_confirmed_at)
      from auth.users u where u.id = v_uid
    ),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'purpose', c.purpose, 'granted', c.granted, 'document_version', c.document_version,
        'source', c.source, 'created_at', c.created_at) order by c.id)
      from public.user_consents c where c.user_id = v_uid
    ), '[]'::jsonb),
    'waitlist', (
      select jsonb_build_object(
        'first_name', w.first_name, 'department', w.department, 'referral_code', w.referral_code,
        'created_at', w.created_at,
        'consents', coalesce((
          select jsonb_agg(jsonb_build_object(
            'purpose', wc.purpose, 'granted', wc.granted, 'document_version', wc.document_version, 'created_at', wc.created_at)
            order by wc.id)
          from public.consents wc where wc.waitlist_id = w.id
        ), '[]'::jsonb))
      from public.profiles p join public.waitlist w on w.id = p.waitlist_id
      where p.id = v_uid
    ),
    'mailbox', (select jsonb_build_object('provider', a.provider, 'email', a.email, 'connected_at', a.connected_at)
                from public.mail_accounts a where a.stacker_id = v_uid),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('department', k.department, 'preset', k.preset, 'daily_target', k.daily_target,
                                                                'status', k.status, 'created_at', k.created_at) order by k.created_at)
                           from public.campaigns k where k.stacker_id = v_uid), '[]'::jsonb),
    'prospects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'siret', c.siret, 'status', c.status, 'claimed_at', c.claimed_at, 'released_at', c.released_at,
        'release_reason', c.release_reason, 'contact_phone', c.contact_phone, 'contact_email', c.contact_email,
        'contact_source', c.contact_source,
        'notes', coalesce((select jsonb_agg(jsonb_build_object('body', n.body, 'created_at', n.created_at) order by n.created_at)
                           from public.prospect_notes n where n.claim_id = c.id), '[]'::jsonb),
        'emails', coalesce((select jsonb_agg(jsonb_build_object('subject', m.subject, 'recipient', m.recipient, 'created_at', m.created_at,
                                                                'marked_sent_at', m.marked_sent_at) order by m.created_at)
                            from public.prospect_emails m where m.claim_id = c.id), '[]'::jsonb)
      ) order by c.claimed_at)
      from public.prospect_claims c where c.stacker_id = v_uid
    ), '[]'::jsonb),
    'deals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reference', d.reference, 'status', d.status, 'company_name', d.company_name, 'company_siret', d.company_siret,
        'offer', (d.offer_snapshot ->> 'brand') || ' · ' || (d.offer_snapshot ->> 'name'),
        'monthly_price_cents', d.monthly_price_cents, 'signed_at', d.signed_at, 'activated_at', d.activated_at, 'ended_at', d.ended_at
      ) order by d.signed_at)
      from public.deals d where d.stacker_id = v_uid
    ), '[]'::jsonb),
    'commissions', coalesce((
      select jsonb_agg(jsonb_build_object('period', e.period, 'amount_cents', e.amount_cents, 'rate_bps', e.rate_bps,
                                          'kind', e.kind, 'status', e.status, 'created_at', e.created_at) order by e.created_at)
      from public.commission_entries e where e.stacker_id = v_uid
    ), '[]'::jsonb),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object('amount_cents', p.amount_cents, 'status', p.status, 'iban_last4', p.iban_last4,
                                          'requested_at', p.requested_at, 'processed_at', p.processed_at) order by p.requested_at)
      from public.payouts p where p.stacker_id = v_uid
    ), '[]'::jsonb),
    'payout_account', (select jsonb_build_object('holder', a.holder, 'iban_last4', a.iban_last4, 'updated_at', a.updated_at)
                       from public.payout_accounts a where a.stacker_id = v_uid),
    'subscription', (select jsonb_build_object('status', b.status, 'method', b.method_label, 'launch_member', b.launch_member,
                                               'launch_until', b.launch_until, 'current_period_end', b.current_period_end, 'created_at', b.created_at)
                     from public.stacker_billing b where b.stacker_id = v_uid),
    'subscription_charges', coalesce((
      select jsonb_agg(jsonb_build_object('period_start', c.period_start, 'amount_cents', c.amount_cents, 'method', c.method,
                                          'status', c.status, 'created_at', c.created_at) order by c.created_at)
      from public.billing_charges c where c.stacker_id = v_uid
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- Fiche deal : un paiement remboursé est signalé, sa reprise n'est pas dupliquée.
create or replace function public.deal_detail(p_deal uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.deal_require_stacker();
  d public.deals%rowtype;
begin
  select * into d from public.deals x where x.id = p_deal and x.stacker_id = v_uid;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', d.id, 'reference', d.reference, 'status', d.status, 'claim_id', d.claim_id,
    'offer', d.offer_snapshot, 'quantity', d.quantity, 'monthly_price_cents', d.monthly_price_cents,
    'company_name', d.company_name, 'company_siret', d.company_siret, 'company_address', d.company_address,
    'contact_name', d.contact_first_name || ' ' || d.contact_last_name, 'contact_role', d.contact_role,
    'contact_email', d.contact_email, 'contact_phone', d.contact_phone,
    'iban_masked', d.iban_country || '•• •••• ' || d.iban_last4, 'mandate_ref', d.mandate_ref,
    'contract_text', d.contract_text, 'contract_sha256', d.contract_sha256, 'signature_png', d.signature_png,
    'signed_at', d.signed_at, 'withdrawal_until', d.withdrawal_until, 'activated_at', d.activated_at,
    'ended_at', d.ended_at,
    'payments', coalesce((select jsonb_agg(jsonb_build_object('period', p.period, 'amount_cents', p.amount_cents, 'paid_at', p.paid_at, 'reversed', p.reversed_at is not null,
                                                              'commission_cents', e.amount_cents, 'rate_bps', e.rate_bps) order by p.period desc)
                          from public.deal_payments p left join public.commission_entries e on e.payment_id = p.id and e.kind = 'commission'
                          where p.deal_id = d.id), '[]'::jsonb)
  );
end;
$$;

-- Gains : lignes de reprise et d'abonnement (sans deal) visibles dans l'historique.
create or replace function public.my_earnings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.deal_require_stacker();
  v_rate integer := public.deal_rate_bps(v_uid);
begin
  return jsonb_build_object(
    'rate_bps', v_rate,
    'available_cents', coalesce((select sum(e.amount_cents) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at <= now()), 0),
    'validating_cents', coalesce((select sum(e.amount_cents) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at > now()), 0),
    'next_available_at', (select min(e.available_at) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at > now()),
    'requested_cents', coalesce((select sum(e.amount_cents) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'demandee'), 0),
    'paid_cents', coalesce((select sum(e.amount_cents) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'versee'), 0),
    'monthly_cents', coalesce((select sum(d.monthly_price_cents) from public.deals d where d.stacker_id = v_uid and d.status = 'actif'), 0) * v_rate / 10000,
    'pending_monthly_cents', coalesce((select sum(d.monthly_price_cents) from public.deals d where d.stacker_id = v_uid and d.status = 'signe'), 0) * v_rate / 10000,
    'signed_count', (select count(*) from public.deals d where d.stacker_id = v_uid and d.status in ('signe', 'actif', 'suspendu')),
    'active_count', (select count(*) from public.deals d where d.stacker_id = v_uid and d.status = 'actif'),
    'min_payout_cents', (select s.min_payout_cents from public.deal_settings s where s.id),
    'payout_account', (select jsonb_build_object('holder', a.holder, 'iban_last4', a.iban_last4) from public.payout_accounts a where a.stacker_id = v_uid),
    'entries', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select jsonb_build_object('id', e.id, 'period', e.period, 'amount_cents', e.amount_cents, 'rate_bps', e.rate_bps,
                                  'client_amount_cents', e.client_amount_cents, 'status', e.status, 'created_at', e.created_at,
                                  'available_at', e.available_at, 'kind', e.kind,
                                  'company_name', d.company_name, 'deal_id', d.id) j, e.created_at
        from public.commission_entries e left join public.deals d on d.id = e.deal_id
        where e.stacker_id = v_uid order by e.created_at desc limit 100) x), '[]'::jsonb),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'amount_cents', p.amount_cents, 'status', p.status, 'iban_last4', p.iban_last4,
                                          'requested_at', p.requested_at, 'processed_at', p.processed_at) order by p.requested_at desc)
      from public.payouts p where p.stacker_id = v_uid), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilèges
-- -----------------------------------------------------------------------------

revoke all on function
  public.stacker_has_access(uuid), public.require_subscription(uuid), public.available_balance(uuid), public.my_billing(), public.billing_set_auto_renew(boolean),
  public.billing_checkout_prepare(uuid), public.billing_set_customer(uuid, text), public.billing_charge_created(uuid, text, date, integer, text),
  public.billing_payment_paid(text, text, text), public.billing_payment_failed(text), public.billing_renew_due(integer),
  public.deal_mollie_pending(integer), public.deal_mollie_progress(uuid, text, text, text, date), public.deal_mollie_failed(uuid, text, boolean),
  public.deal_mollie_cancels(integer), public.deal_mollie_cancelled(uuid), public.deal_payment_from_mollie(text, date, integer, text),
  public.deal_payment_failed_from_mollie(text, text), public.deal_payment_reversed(text)
  from public, anon, authenticated, service_role;

grant execute on function public.my_billing(), public.billing_set_auto_renew(boolean) to authenticated;

grant execute on function
  public.billing_checkout_prepare(uuid), public.billing_set_customer(uuid, text), public.billing_charge_created(uuid, text, date, integer, text),
  public.billing_payment_paid(text, text, text), public.billing_payment_failed(text), public.billing_renew_due(integer),
  public.deal_mollie_pending(integer), public.deal_mollie_progress(uuid, text, text, text, date), public.deal_mollie_failed(uuid, text, boolean),
  public.deal_mollie_cancels(integer), public.deal_mollie_cancelled(uuid), public.deal_payment_from_mollie(text, date, integer, text),
  public.deal_payment_failed_from_mollie(text, text), public.deal_payment_reversed(text)
  to service_role;
