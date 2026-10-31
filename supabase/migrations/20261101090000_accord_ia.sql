-- =============================================================================
-- Stacker — Accord avant l'entraînement face à l'IA
--
--   Ce que le stacker dit pendant un appel d'entraînement est envoyé à un
--   prestataire d'IA (Anthropic) pour jouer le commerçant et noter l'appel.
--   Avant le premier appel, l'app le dit clairement et demande l'accord du
--   stacker (exigence RGPD et règles App Store 5.1.2). L'accord est
--   enregistré (profiles.ai_consent_at) et vérifié par le serveur à chaque
--   début d'appel ; il peut être retiré (roleplay_consent(false)).
-- =============================================================================

alter table public.profiles add column ai_consent_at timestamptz;

create function public.roleplay_consent(p_accept boolean)
returns void
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
  update public.profiles set ai_consent_at = case when p_accept then coalesce(ai_consent_at, now()) else null end where id = v_uid;
end;
$$;
revoke all on function public.roleplay_consent(boolean) from public, anon, authenticated, service_role;
grant execute on function public.roleplay_consent(boolean) to authenticated;

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
