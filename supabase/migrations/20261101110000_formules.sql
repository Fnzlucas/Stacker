-- =============================================================================
-- Stacker — Trois formules
--
--   * Academy        12,99 €/mois : entraînement face à l'IA et formation.
--   * Pro             9,99 €/mois : logiciel de prospection, campagnes,
--                     signature des clients, commissions.
--   * Academy + Pro  14,99 €/mois : les deux.
--
--   Accès (seulement quand app_flags.billing_required est activé) :
--     - prospection, campagnes, signature : Pro ou Academy + Pro
--       (stacker_has_access, inchangé pour tous les écrans qui l'utilisent) ;
--     - entraînement face à l'IA : Academy ou Academy + Pro
--       (stacker_has_academy). Exception : l'appel d'habilitation exigé avant
--       la première signature (roleplay_required) reste ouvert aux stackers Pro.
--   Changer de formule en cours d'abonnement : appliqué au prochain
--   renouvellement (pending_plan), au prix de la nouvelle formule.
--   Les abonnés existants passent sur Academy + Pro.
-- =============================================================================

alter table public.billing_settings
  add column price_academy_cents integer not null default 1299,
  add column price_pro_cents     integer not null default 999,
  add column price_duo_cents     integer not null default 1499,
  add constraint billing_settings_plans check (price_academy_cents between 100 and 100000 and price_pro_cents between 100 and 100000
    and price_duo_cents between 100 and 100000);

alter table public.stacker_billing
  add column plan         text not null default 'duo',
  add column pending_plan text,
  add constraint stacker_billing_plan check (plan in ('academy', 'pro', 'duo') and (pending_plan is null or pending_plan in ('academy', 'pro', 'duo')));

create function public.billing_plan_price(p_plan text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case p_plan when 'academy' then s.price_academy_cents when 'pro' then s.price_pro_cents else s.price_duo_cents end
  from public.billing_settings s where s.id
$$;

-- Abonnement en cours (payé, ou impayé pendant la période de grâce).
create function public.billing_current(p_stacker uuid)
returns public.stacker_billing
language sql
stable
security definer
set search_path = ''
as $$
  select b.* from public.stacker_billing b, public.billing_settings s
  where b.stacker_id = p_stacker and s.id and b.status in ('actif', 'impaye')
    and case when b.cancel_at_period_end then b.current_period_end > public.paris_today()
             else b.current_period_end + s.grace_days >= public.paris_today() end
$$;

-- Accès Pro : prospection, campagnes, signature.
create or replace function public.stacker_has_access(p_stacker uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public.app_flag('billing_required') or coalesce((public.billing_current(p_stacker)).plan in ('pro', 'duo'), false)
$$;

-- Accès Academy : entraînement face à l'IA.
create function public.stacker_has_academy(p_stacker uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public.app_flag('billing_required') or coalesce((public.billing_current(p_stacker)).plan in ('academy', 'duo'), false)
$$;

-- Changer de formule : immédiat sans abonnement en cours, sinon au prochain renouvellement.
create function public.billing_set_plan(p_plan text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  b public.stacker_billing%rowtype;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_plan is null or p_plan not in ('academy', 'pro', 'duo') then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;
  insert into public.stacker_billing (stacker_id, plan) values (v_uid, p_plan) on conflict (stacker_id) do nothing;
  select * into b from public.stacker_billing x where x.stacker_id = v_uid for update;
  if b.status in ('actif', 'impaye') then
    update public.stacker_billing set pending_plan = case when p_plan = plan then null else p_plan end, updated_at = now() where stacker_id = v_uid;
  else
    update public.stacker_billing set plan = p_plan, pending_plan = null, updated_at = now() where stacker_id = v_uid;
  end if;
  return public.my_billing();
end;
$$;

create or replace function public.my_billing()
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
    'has_academy', public.stacker_has_academy(v_uid),
    'status', coalesce(b.status, 'aucun'),
    'plan', coalesce(b.plan, 'duo'),
    'pending_plan', b.pending_plan,
    'price_cents', public.billing_plan_price(coalesce(b.plan, 'duo')),
    'prices', jsonb_build_object('academy', s.price_academy_cents, 'pro', s.price_pro_cents, 'duo', s.price_duo_cents),
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

drop function public.billing_checkout_prepare(uuid, text, boolean);
create function public.billing_checkout_prepare(p_stacker uuid, p_terms_version text, p_immediate_start boolean, p_plan text)
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
  if p_plan is null or p_plan not in ('academy', 'pro', 'duo') then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;
  insert into public.stacker_billing (stacker_id) values (p_stacker) on conflict (stacker_id) do nothing;
  select * into b from public.stacker_billing x where x.stacker_id = p_stacker for update;
  if b.status = 'actif' and b.current_period_end >= public.paris_today() then
    raise exception 'already_active' using errcode = 'P0001';
  end if;
  update public.stacker_billing
  set status = case when status in ('aucun', 'resilie') then 'en_attente' else status end,
      cancel_at_period_end = case when status in ('aucun', 'resilie') then false else cancel_at_period_end end,
      plan = p_plan, pending_plan = null,
      terms_version = p_terms_version, terms_accepted_at = now(), immediate_start_at = now(),
      updated_at = now()
  where stacker_id = p_stacker;
  return jsonb_build_object(
    'customer_id', b.mollie_customer_id,
    'name', nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
    'email', (select u.email from auth.users u where u.id = p_stacker),
    'amount_cents', public.billing_plan_price(p_plan),
    'plan', p_plan,
    'period_start', public.paris_today()
  );
end;
$$;

create or replace function public.billing_renew_due(p_limit integer)
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
    select x.*, public.billing_plan_price(coalesce(x.pending_plan, x.plan)) as price from public.stacker_billing x
    where x.status = 'actif' and x.current_period_end <= public.paris_today() and not x.cancel_at_period_end
      and not exists (select 1 from public.billing_charges c where c.stacker_id = x.stacker_id and c.period_start = x.current_period_end and c.status <> 'echoue')
    order by x.current_period_end
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  loop
    -- Changement de formule demandé : appliqué au renouvellement.
    if b.pending_plan is not null then
      update public.stacker_billing set plan = b.pending_plan, pending_plan = null, updated_at = now() where stacker_id = b.stacker_id;
    end if;
    if public.available_balance(b.stacker_id) >= b.price then
      insert into public.billing_charges (stacker_id, kind, period_start, amount_cents, method, status)
      values (b.stacker_id, 'mensuel', b.current_period_end, b.price, 'commissions', 'paye');
      insert into public.commission_entries (stacker_id, period, client_amount_cents, rate_bps, amount_cents, kind, available_at)
      values (b.stacker_id, b.current_period_end, 0, 0, -b.price, 'abonnement', now());
      update public.stacker_billing set current_period_end = (current_period_end + interval '1 month')::date, updated_at = now()
      where stacker_id = b.stacker_id;
    elsif b.mollie_customer_id is not null and b.mollie_mandate_id is not null then
      v_out := v_out || jsonb_build_object('stacker_id', b.stacker_id, 'customer_id', b.mollie_customer_id, 'mandate_id', b.mollie_mandate_id,
                                           'period_start', b.current_period_end, 'amount_cents', b.price);
    else
      update public.stacker_billing set status = 'impaye', updated_at = now() where stacker_id = b.stacker_id;
    end if;
  end loop;
  return v_out;
end;
$$;

create or replace function public.roleplay_start(p_stacker uuid, p_scenario text, p_opening text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.roleplay_settings%rowtype;
  v_id uuid;
begin
  select * into s from public.roleplay_settings where id;
  if not exists (select 1 from public.profiles p where p.id = p_stacker and p.onboarding_completed_at is not null) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  if (select p.ai_consent_at from public.profiles p where p.id = p_stacker) is null then
    raise exception 'consent_required' using errcode = '42501';
  end if;
  -- Formule Academy (ou Academy + Pro). Sans elle, seul l'appel d'habilitation
  -- exigé avant la première signature reste possible pour un stacker Pro.
  if not public.stacker_has_academy(p_stacker)
     and not (public.app_flag('roleplay_required') and public.stacker_has_access(p_stacker) and not public.roleplay_has_passed(p_stacker)) then
    raise exception 'academy_required' using errcode = 'P0001';
  end if;
  if p_scenario is null or p_scenario !~ '^[a-z0-9-]{2,40}$' or p_opening is null or char_length(p_opening) not between 1 and 400 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform 1 from public.profiles p where p.id = p_stacker for update;
  if (select count(*) from public.roleplay_sessions r
      where r.stacker_id = p_stacker and (r.started_at at time zone 'Europe/Paris')::date = public.paris_today()) >= s.sessions_per_day then
    raise exception 'daily_quota' using errcode = '54000';
  end if;
  if (select count(*) from public.roleplay_sessions r
      where r.started_at >= (date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')) >= s.monthly_sessions_cap then
    raise exception 'unavailable' using errcode = '54000';
  end if;
  update public.roleplay_sessions r set status = 'abandonnee', ended_at = now() where r.stacker_id = p_stacker and r.status = 'en_cours';
  insert into public.roleplay_sessions (stacker_id, scenario, turns)
  values (p_stacker, p_scenario, jsonb_build_array(jsonb_build_object('role', 'prospect', 'text', p_opening, 'at', now())))
  returning id into v_id;
  return jsonb_build_object('session_id', v_id, 'max_chars', s.max_chars, 'max_turns', s.max_turns);
end;
$$;

create or replace function public.my_roleplay()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s public.roleplay_settings%rowtype;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform public.roleplay_expire(v_uid);
  select * into s from public.roleplay_settings where id;
  return jsonb_build_object(
    'required', public.app_flag('roleplay_required'),
    'passed', public.roleplay_has_passed(v_uid),
    'academy', public.stacker_has_academy(v_uid),
    'qualification', public.app_flag('roleplay_required') and public.stacker_has_access(v_uid) and not public.roleplay_has_passed(v_uid),
    'consented', (select p.ai_consent_at is not null from public.profiles p where p.id = v_uid),
    'pass_score', s.pass_score,
    'min_stacker_turns', s.min_stacker_turns,
    'today', jsonb_build_object(
      'used', (select count(*) from public.roleplay_sessions r
               where r.stacker_id = v_uid and (r.started_at at time zone 'Europe/Paris')::date = public.paris_today()),
      'limit', s.sessions_per_day),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'scenario', h.scenario, 'status', h.status, 'score', h.score,
                                                             'passed', h.passed, 'started_at', h.started_at) order by h.started_at desc)
                         from (select * from public.roleplay_sessions r where r.stacker_id = v_uid order by r.started_at desc limit 20) h), '[]'::jsonb));
end;
$$;

update public.billing_settings set price_cents = 999;

revoke all on function public.billing_plan_price(text), public.billing_current(uuid), public.stacker_has_academy(uuid), public.billing_set_plan(text),
  public.billing_checkout_prepare(uuid, text, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.billing_set_plan(text) to authenticated;
grant execute on function public.billing_checkout_prepare(uuid, text, boolean, text) to service_role;

-- Email de confirmation : prix et nom de la formule choisie.
create or replace function public.emails_on_billing_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'actif' and old.status in ('aucun', 'en_attente', 'resilie') then
    perform public.email_enqueue('abonnement_confirme', 'abonnement_confirme:' || new.stacker_id || ':' || coalesce(new.current_period_end::text, 'x'),
      new.stacker_id, null, null,
      jsonb_build_object('price_cents', public.billing_plan_price(new.plan), 'plan', new.plan, 'launch_member', new.launch_member,
                         'launch_until', new.launch_until, 'period_end', new.current_period_end, 'terms_version', new.terms_version));
  end if;
  if new.cancel_at_period_end and not old.cancel_at_period_end and new.status in ('actif', 'impaye') then
    perform public.email_enqueue('abonnement_resilie', 'abonnement_resilie:' || new.stacker_id || ':' || to_char(now(), 'YYYY-MM-DD"T"HH24MISS'),
      new.stacker_id, null, null, jsonb_build_object('access_until', new.current_period_end));
  end if;
  return null;
end;
$$;
