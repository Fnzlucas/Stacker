-- =============================================================================
-- Stacker — Lot 10 : entraînement à l'appel face à une IA
--
--   Le stacker passe un appel (à la voix, ou à l'écrit) face à un commerçant
--   fictif joué par une IA, puis reçoit un bilan noté. Une simulation réussie
--   est exigée avant la première signature quand l'interrupteur
--   app_flags.roleplay_required est activé (coupé par défaut, comme
--   billing_required : il s'active le jour du lancement).
--
--   Sécurité : l'historique de l'appel est conservé côté serveur. Le
--   navigateur n'envoie que la dernière phrase du stacker : il ne peut ni
--   réécrire la conversation ni fabriquer son bilan. Seule l'Edge Function
--   « roleplay » (service_role) écrit dans ces tables.
--
--   Coûts : sessions par stacker et par jour, nombre de répliques par
--   session, longueur des phrases, et plafond global de sessions par mois.
-- =============================================================================

create table public.roleplay_settings (
  id                     boolean primary key default true,
  sessions_per_day       integer not null default 8,
  monthly_sessions_cap   integer not null default 3000,
  max_turns              integer not null default 24,
  max_chars              integer not null default 600,
  pass_score             integer not null default 70,
  min_stacker_turns      integer not null default 5,
  session_ttl_minutes    integer not null default 30,
  constraint roleplay_settings_singleton check (id),
  constraint roleplay_settings_bounds check (
    sessions_per_day between 1 and 50 and monthly_sessions_cap >= 0 and max_turns between 6 and 60
    and max_chars between 100 and 2000 and pass_score between 1 and 100 and min_stacker_turns between 1 and 30
    and session_ttl_minutes between 5 and 120)
);
insert into public.roleplay_settings (id) values (true);

create table public.roleplay_sessions (
  id              uuid primary key default gen_random_uuid(),
  stacker_id      uuid not null references public.profiles (id) on delete cascade,
  scenario        text not null,
  status          text not null default 'en_cours',
  turns           jsonb not null default '[]'::jsonb,
  score           integer,
  passed          boolean not null default false,
  feedback        jsonb,
  tokens_in       integer not null default 0,
  tokens_out      integer not null default 0,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  constraint roleplay_sessions_scenario_check check (scenario ~ '^[a-z0-9-]{2,40}$'),
  constraint roleplay_sessions_status_check check (status in ('en_cours', 'terminee', 'abandonnee')),
  constraint roleplay_sessions_turns_check check (jsonb_typeof(turns) = 'array'),
  constraint roleplay_sessions_score_check check (score is null or score between 0 and 100)
);
create index roleplay_sessions_stacker_idx on public.roleplay_sessions (stacker_id, started_at desc);

revoke all on table public.roleplay_settings, public.roleplay_sessions from public, anon, authenticated, service_role;
alter table public.roleplay_settings enable row level security;
alter table public.roleplay_settings force row level security;
alter table public.roleplay_sessions enable row level security;
alter table public.roleplay_sessions force row level security;
create policy roleplay_settings_owner on public.roleplay_settings for all to postgres using (true) with check (true);
create policy roleplay_sessions_owner on public.roleplay_sessions for all to postgres using (true) with check (true);

insert into public.app_flags (key, enabled) values ('roleplay_required', false);

-- -----------------------------------------------------------------------------
-- Lecture interne
-- -----------------------------------------------------------------------------

create function public.roleplay_has_passed(p_stacker uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.roleplay_sessions r where r.stacker_id = p_stacker and r.passed);
$$;

-- Ferme les sessions restées ouvertes au-delà de leur durée de vie.
create function public.roleplay_expire(p_stacker uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.roleplay_sessions r set status = 'abandonnee', ended_at = now()
  where r.stacker_id = p_stacker and r.status = 'en_cours'
    and r.started_at < now() - make_interval(mins => (select s.session_ttl_minutes from public.roleplay_settings s));
$$;

-- -----------------------------------------------------------------------------
-- Appelées par l'Edge Function « roleplay » (service_role)
-- -----------------------------------------------------------------------------

create function public.roleplay_start(p_stacker uuid, p_scenario text, p_opening text)
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

-- Session en cours du stacker, pour construire l'appel à l'IA.
create function public.roleplay_get(p_stacker uuid, p_session uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.roleplay_sessions%rowtype;
  s public.roleplay_settings%rowtype;
begin
  perform public.roleplay_expire(p_stacker);
  select * into s from public.roleplay_settings where id;
  select * into r from public.roleplay_sessions x where x.id = p_session and x.stacker_id = p_stacker;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'en_cours' then
    raise exception 'session_closed' using errcode = '55000';
  end if;
  return jsonb_build_object('scenario', r.scenario, 'turns', r.turns, 'max_chars', s.max_chars, 'max_turns', s.max_turns,
    'stacker_turns', (select count(*) from jsonb_array_elements(r.turns) t where t ->> 'role' = 'stacker'));
end;
$$;

-- Ajoute la phrase du stacker et la réponse du commerçant (ensemble, ou rien).
create function public.roleplay_append(p_stacker uuid, p_session uuid, p_said text, p_reply text, p_hung_up boolean, p_tokens_in integer, p_tokens_out integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.roleplay_sessions%rowtype;
  s public.roleplay_settings%rowtype;
begin
  select * into s from public.roleplay_settings where id;
  if p_said is null or char_length(btrim(p_said)) = 0 or char_length(p_said) > s.max_chars
     or p_reply is null or char_length(p_reply) not between 1 and 1200 or p_hung_up is null
     or coalesce(p_tokens_in, -1) < 0 or coalesce(p_tokens_out, -1) < 0 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into r from public.roleplay_sessions x where x.id = p_session and x.stacker_id = p_stacker for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'en_cours' then
    raise exception 'session_closed' using errcode = '55000';
  end if;
  if jsonb_array_length(r.turns) + 2 > s.max_turns then
    raise exception 'too_long' using errcode = '54000';
  end if;
  update public.roleplay_sessions x
  set turns = x.turns || jsonb_build_array(
        jsonb_build_object('role', 'stacker', 'text', btrim(p_said), 'at', now()),
        jsonb_build_object('role', 'prospect', 'text', p_reply, 'at', now(), 'hung_up', p_hung_up)),
      tokens_in = x.tokens_in + p_tokens_in,
      tokens_out = x.tokens_out + p_tokens_out
  where x.id = p_session
  returning * into r;
  return jsonb_build_object('turns', jsonb_array_length(r.turns), 'max_turns', s.max_turns);
end;
$$;

-- Bilan : enregistré une seule fois. Réussite = note suffisante ET appel assez long.
create function public.roleplay_finish(p_stacker uuid, p_session uuid, p_score integer, p_feedback jsonb, p_tokens_in integer, p_tokens_out integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.roleplay_sessions%rowtype;
  s public.roleplay_settings%rowtype;
  v_turns integer;
  v_passed boolean;
begin
  select * into s from public.roleplay_settings where id;
  if p_score is null or p_score not between 0 and 100 or p_feedback is null or jsonb_typeof(p_feedback) <> 'object'
     or octet_length(p_feedback::text) > 8000 or coalesce(p_tokens_in, -1) < 0 or coalesce(p_tokens_out, -1) < 0 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  select * into r from public.roleplay_sessions x where x.id = p_session and x.stacker_id = p_stacker for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'en_cours' then
    raise exception 'session_closed' using errcode = '55000';
  end if;
  v_turns := (select count(*) from jsonb_array_elements(r.turns) t where t ->> 'role' = 'stacker');
  v_passed := p_score >= s.pass_score and v_turns >= s.min_stacker_turns;
  update public.roleplay_sessions x
  set status = 'terminee', ended_at = now(), score = p_score, passed = v_passed, feedback = p_feedback,
      tokens_in = x.tokens_in + p_tokens_in, tokens_out = x.tokens_out + p_tokens_out
  where x.id = p_session;
  return jsonb_build_object('score', p_score, 'passed', v_passed, 'stacker_turns', v_turns,
    'min_stacker_turns', s.min_stacker_turns, 'pass_score', s.pass_score);
end;
$$;

-- -----------------------------------------------------------------------------
-- Appelées par l'app (authenticated)
-- -----------------------------------------------------------------------------

create function public.my_roleplay()
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

create function public.roleplay_detail(p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.roleplay_sessions%rowtype;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select * into r from public.roleplay_sessions x where x.id = p_session and x.stacker_id = v_uid;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', r.id, 'scenario', r.scenario, 'status', r.status, 'score', r.score, 'passed', r.passed,
    'feedback', r.feedback, 'started_at', r.started_at, 'ended_at', r.ended_at,
    'turns', coalesce((select jsonb_agg(jsonb_build_object('role', t ->> 'role', 'text', t ->> 'text') order by n)
                       from jsonb_array_elements(r.turns) with ordinality as e(t, n)), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- Signature : une simulation réussie est exigée quand l'interrupteur est actif
-- -----------------------------------------------------------------------------

create function public.deals_require_training()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stacker_id is not null and public.app_flag('roleplay_required') and not public.roleplay_has_passed(new.stacker_id) then
    raise exception 'training_required' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger deals_require_training before insert on public.deals for each row execute function public.deals_require_training();

-- Interrupteur pilotable depuis l'admin.
create or replace function public.admin_set_flag(p_key text, p_enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.admin_require();
begin
  if p_key not in ('prospects_enabled', 'campaigns_enabled', 'leads_enrich_enabled', 'billing_required', 'roleplay_required') or p_enabled is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  update public.app_flags set enabled = p_enabled, updated_at = now() where key = p_key;
  perform public.admin_audit(v_uid, 'flag', p_key, jsonb_build_object('enabled', p_enabled));
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilèges
-- -----------------------------------------------------------------------------

revoke all on function public.roleplay_has_passed(uuid), public.roleplay_expire(uuid), public.roleplay_start(uuid, text, text), public.roleplay_get(uuid, uuid),
  public.roleplay_append(uuid, uuid, text, text, boolean, integer, integer), public.roleplay_finish(uuid, uuid, integer, jsonb, integer, integer),
  public.my_roleplay(), public.roleplay_detail(uuid), public.deals_require_training()
  from public, anon, authenticated, service_role;
grant execute on function public.roleplay_start(uuid, text, text), public.roleplay_get(uuid, uuid),
  public.roleplay_append(uuid, uuid, text, text, boolean, integer, integer), public.roleplay_finish(uuid, uuid, integer, jsonb, integer, integer)
  to service_role;
grant execute on function public.my_roleplay(), public.roleplay_detail(uuid) to authenticated;
revoke all on function public.admin_set_flag(text, boolean) from public, anon, service_role;
grant execute on function public.admin_set_flag(text, boolean) to authenticated;

-- Export RGPD : entraînements (scénario, note, bilan, conversation).
do $do$
declare
  v_def text := pg_get_functiondef('public.export_my_data()'::regprocedure);
begin
  if position('''formation''' in v_def) = 0 then
    raise exception 'export_my_data : point d''insertion introuvable';
  end if;
  v_def := replace(v_def, $$'formation', coalesce(($$,
    $$'roleplay_sessions', coalesce((select jsonb_agg(jsonb_build_object('scenario', r.scenario, 'status', r.status, 'score', r.score, 'passed', r.passed,
                                                                      'feedback', r.feedback, 'turns', r.turns, 'started_at', r.started_at, 'ended_at', r.ended_at)
                                                   order by r.started_at)
                                    from public.roleplay_sessions r where r.stacker_id = v_uid), '[]'::jsonb),
    'formation', coalesce(($$);
  execute v_def;
end;
$do$;
