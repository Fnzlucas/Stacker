-- =============================================================================
-- Stacker — Lot 9 : prêt pour l'ouverture
--
--   1. Souscription : acceptation des CGV (version) et demande expresse
--      d'accès immédiat avant la fin du délai de rétractation, enregistrées.
--   2. Emails promis par les CGV : confirmation de souscription, confirmation
--      de résiliation.
--   3. Formation : progression du stacker module par module.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Consentements à la souscription
-- -----------------------------------------------------------------------------

alter table public.stacker_billing
  add column terms_version       text,
  add column terms_accepted_at   timestamptz,
  add column immediate_start_at  timestamptz;

drop function public.billing_checkout_prepare(uuid);

create function public.billing_checkout_prepare(p_stacker uuid, p_terms_version text, p_immediate_start boolean)
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
  if p_terms_version is null or p_terms_version !~ '^\d{4}-\d{2}-\d{2}$' or p_immediate_start is not true then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  insert into public.stacker_billing (stacker_id) values (p_stacker) on conflict (stacker_id) do nothing;
  select * into b from public.stacker_billing x where x.stacker_id = p_stacker for update;
  if b.status = 'actif' and b.current_period_end >= public.paris_today() then
    raise exception 'already_active' using errcode = 'P0001';
  end if;
  update public.stacker_billing
  set status = case when status in ('aucun', 'resilie') then 'en_attente' else status end,
      cancel_at_period_end = case when status in ('aucun', 'resilie') then false else cancel_at_period_end end,
      terms_version = p_terms_version, terms_accepted_at = now(), immediate_start_at = now(),
      updated_at = now()
  where stacker_id = p_stacker;
  return jsonb_build_object(
    'customer_id', b.mollie_customer_id,
    'name', nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    'email', (select u.email from auth.users u where u.id = p_stacker),
    'amount_cents', (select s.price_cents from public.billing_settings s where s.id),
    'period_start', public.paris_today()
  );
end;
$$;
revoke all on function public.billing_checkout_prepare(uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.billing_checkout_prepare(uuid, text, boolean) to service_role;

-- Export RGPD : consentements de souscription.
create or replace function public.billing_consents(p_stacker uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('terms_version', b.terms_version, 'terms_accepted_at', b.terms_accepted_at, 'immediate_start_at', b.immediate_start_at)
  from public.stacker_billing b where b.stacker_id = p_stacker;
$$;
revoke all on function public.billing_consents(uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Emails de confirmation
-- -----------------------------------------------------------------------------

alter table public.email_outbox drop constraint email_outbox_kind;
alter table public.email_outbox add constraint email_outbox_kind check (kind in ('contrat_client', 'contrat_stacker', 'prenotification', 'bienvenue', 'abonnement_refuse',
  'abonnement_coupe', 'prelevement_refuse', 'virement_verse', 'virement_refuse', 'abonnement_confirme', 'abonnement_resilie'));

create function public.emails_on_billing_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price integer := (select s.price_cents from public.billing_settings s where s.id);
begin
  -- Souscription confirmée (premier paiement reçu, ou réabonnement).
  if new.status = 'actif' and old.status in ('aucun', 'en_attente', 'resilie') then
    perform public.email_enqueue('abonnement_confirme', 'abonnement_confirme:' || new.stacker_id || ':' || coalesce(new.current_period_end::text, 'x'),
      new.stacker_id, null, null,
      jsonb_build_object('price_cents', v_price, 'launch_member', new.launch_member, 'launch_until', new.launch_until,
                         'period_end', new.current_period_end, 'terms_version', new.terms_version));
  end if;
  -- Résiliation demandée par le stacker.
  if new.cancel_at_period_end and not old.cancel_at_period_end and new.status in ('actif', 'impaye') then
    perform public.email_enqueue('abonnement_resilie', 'abonnement_resilie:' || new.stacker_id || ':' || to_char(now(), 'YYYY-MM-DD"T"HH24MISS'),
      new.stacker_id, null, null, jsonb_build_object('access_until', new.current_period_end));
  end if;
  return null;
end;
$$;
revoke all on function public.emails_on_billing_change() from public, anon, authenticated, service_role;
create trigger stacker_billing_emails_change after update of status, cancel_at_period_end on public.stacker_billing
  for each row execute function public.emails_on_billing_change();

-- -----------------------------------------------------------------------------
-- 3. Formation
-- -----------------------------------------------------------------------------

create table public.formation_progress (
  stacker_id   uuid not null references public.profiles (id) on delete cascade,
  module_id    text not null,
  completed_at timestamptz not null default now(),
  primary key (stacker_id, module_id),
  constraint formation_progress_module check (module_id ~ '^[a-z0-9-]{2,40}$')
);
revoke all on table public.formation_progress from public, anon, authenticated, service_role;
alter table public.formation_progress enable row level security;
alter table public.formation_progress force row level security;
create policy formation_progress_owner on public.formation_progress for all to postgres using (true) with check (true);

create function public.my_formation()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(f.module_id order by f.completed_at) from public.formation_progress f where f.stacker_id = v_uid), '[]'::jsonb);
end;
$$;

create function public.formation_set_done(p_module text, p_done boolean)
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
  if p_module is null or p_module !~ '^[a-z0-9-]{2,40}$' or p_done is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if (select count(*) from public.formation_progress f where f.stacker_id = v_uid) >= 50 and p_done then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  if p_done then
    insert into public.formation_progress (stacker_id, module_id) values (v_uid, p_module) on conflict do nothing;
  else
    delete from public.formation_progress where stacker_id = v_uid and module_id = p_module;
  end if;
  return public.my_formation();
end;
$$;

revoke all on function public.my_formation(), public.formation_set_done(text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.my_formation(), public.formation_set_done(text, boolean) to authenticated;

-- Export RGPD : consentements de souscription et formation.
do $do$
declare
  v_def text := pg_get_functiondef('public.export_my_data()'::regprocedure);
begin
  if position('''subscription_charges''' in v_def) = 0 then
    raise exception 'export_my_data : point d''insertion introuvable';
  end if;
  v_def := replace(v_def, $$'subscription_charges', coalesce(($$,
    $$'subscription_consents', public.billing_consents(v_uid),
    'formation', coalesce((select jsonb_agg(jsonb_build_object('module', f.module_id, 'completed_at', f.completed_at) order by f.completed_at)
                           from public.formation_progress f where f.stacker_id = v_uid), '[]'::jsonb),
    'subscription_charges', coalesce(($$);
  execute v_def;
end;
$do$;
