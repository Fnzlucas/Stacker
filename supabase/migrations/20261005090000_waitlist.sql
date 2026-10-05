-- =============================================================================
-- Stacker — Lot 1 : liste d'attente
--
-- Principes (audit/00_verdict_lead.md §1) :
--   * RLS activée ET forcée sur toutes les tables, aucun droit pour anon et
--     authenticated : aucune lecture ni écriture directe depuis le navigateur.
--   * Toute écriture passe par une fonction SECURITY DEFINER avec
--     search_path vide (noms entièrement qualifiés) et EXECUTE réservé au rôle
--     qui doit l'appeler.
--   * Seule exposition publique : waitlist_count(), qui ne renvoie qu'un entier.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.waitlist (
  id            uuid primary key default gen_random_uuid(),
  -- Ordre d'inscription : la position affichée est le rang dans cette séquence.
  signup_seq    bigint generated always as identity,
  -- Email déjà normalisé par l'Edge Function (NFKC, trim, minuscules).
  email         text not null,
  first_name    text not null,
  department    text,
  referral_code text not null,
  referred_by   uuid references public.waitlist (id) on delete set null,
  age_confirmed boolean not null,
  created_at    timestamptz not null default now(),

  constraint waitlist_signup_seq_key unique (signup_seq),
  constraint waitlist_email_key unique (email),
  constraint waitlist_referral_code_key unique (referral_code),
  constraint waitlist_email_format check (
    email = lower(btrim(email))
    and char_length(email) between 3 and 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  constraint waitlist_first_name_format check (
    first_name = btrim(first_name) and char_length(first_name) between 1 and 50
  ),
  constraint waitlist_department_format check (
    department is null
    or department ~ '^(0[1-9]|1[0-9]|2[1-9]|[3-8][0-9]|9[0-5]|2A|2B|97[1-46])$'
  ),
  constraint waitlist_referral_code_format check (referral_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  constraint waitlist_age_confirmed check (age_confirmed),
  constraint waitlist_not_self_referred check (referred_by is distinct from id)
);

comment on table public.waitlist is
  'Liste d''attente publique. Écriture uniquement via waitlist_join() (service_role). Aucune lecture client.';

create index waitlist_referred_by_idx on public.waitlist (referred_by) where referred_by is not null;

-- Consentements : journal append-only, versionné (preuve RGPD).
create table public.consents (
  id               bigint generated always as identity primary key,
  waitlist_id      uuid not null references public.waitlist (id) on delete cascade,
  purpose          text not null,
  granted          boolean not null,
  document_version text not null,
  source           text not null default 'waitlist_form',
  created_at       timestamptz not null default now(),

  constraint consents_purpose_check check (purpose in ('terms_privacy', 'marketing_email')),
  constraint consents_document_version_check check (char_length(document_version) between 1 and 40),
  constraint consents_source_check check (char_length(source) between 1 and 40)
);

comment on table public.consents is
  'Journal append-only des consentements. UPDATE, DELETE et TRUNCATE interdits (sauf effacement RGPD via waitlist_erase()).';

create index consents_waitlist_id_idx on public.consents (waitlist_id);

-- Compteurs de rate limit (fenêtres fixes). La clé est un hash : jamais d'IP en clair.
create table public.rate_limits (
  bucket       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start),
  constraint rate_limits_bucket_check check (char_length(bucket) between 1 and 200)
);

comment on table public.rate_limits is 'Compteurs de rate limit par fenêtre fixe. Clés hachées, purge après 24 h.';

create index rate_limits_window_start_idx on public.rate_limits (window_start);

-- -----------------------------------------------------------------------------
-- Droits : rien pour le navigateur. Supabase accorde par défaut ALL sur les
-- nouvelles tables à anon/authenticated/service_role : on retire tout.
-- -----------------------------------------------------------------------------

revoke all on table public.waitlist, public.consents, public.rate_limits from public, anon, authenticated, service_role;
revoke all on sequence public.waitlist_signup_seq_seq, public.consents_id_seq from public, anon, authenticated, service_role;

alter table public.waitlist enable row level security;
alter table public.waitlist force row level security;
alter table public.consents enable row level security;
alter table public.consents force row level security;
alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;

-- Aucune politique pour anon / authenticated / service_role : refus par défaut.
-- RLS forcée s'applique aussi au propriétaire des tables : les fonctions
-- SECURITY DEFINER (propriétaire « postgres ») ont besoin de ces politiques,
-- qui ne concernent que ce rôle d'administration (inutiles s'il a BYPASSRLS).
create policy waitlist_owner_all on public.waitlist
  as permissive for all to postgres using (true) with check (true);
create policy consents_owner_all on public.consents
  as permissive for all to postgres using (true) with check (true);
create policy rate_limits_owner_all on public.rate_limits
  as permissive for all to postgres using (true) with check (true);

-- -----------------------------------------------------------------------------
-- Journal de consentements append-only
-- -----------------------------------------------------------------------------

create function public.consents_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Seule exception : l'effacement RGPD, qui positionne ce drapeau local
  -- à la transaction (waitlist_erase()).
  if tg_op = 'DELETE' and coalesce(current_setting('stacker.erasure', true), '') = 'on' then
    return old;
  end if;
  raise exception 'consents_append_only' using errcode = '42501',
    hint = 'Le journal des consentements est append-only : ajoute une nouvelle ligne.';
end;
$$;

revoke all on function public.consents_append_only() from public, anon, authenticated, service_role;

create trigger consents_append_only_row
  before update or delete on public.consents
  for each row execute function public.consents_append_only();

create trigger consents_append_only_truncate
  before truncate on public.consents
  for each statement execute function public.consents_append_only();

-- -----------------------------------------------------------------------------
-- Fonctions
-- -----------------------------------------------------------------------------

-- Compteur public : un entier, rien d'autre.
create function public.waitlist_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.waitlist;
$$;

comment on function public.waitlist_count() is 'Nombre d''inscrits sur la liste d''attente (public, lecture seule).';

revoke all on function public.waitlist_count() from public, anon, authenticated, service_role;
grant execute on function public.waitlist_count() to anon, authenticated, service_role;

-- Rate limit à fenêtre fixe. Renvoie true si la requête est autorisée.
create function public.rate_limit_hit(p_bucket text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits   integer;
begin
  if p_bucket is null or p_max is null or p_window_seconds is null
     or p_max < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid_rate_limit_arguments' using errcode = '22023';
  end if;

  v_window := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  -- Purge opportuniste des fenêtres de plus de 24 h (par petits lots, sans attente).
  delete from public.rate_limits
  where ctid in (
    select ctid from public.rate_limits
    where window_start < clock_timestamp() - interval '1 day'
    limit 100
    for update skip locked
  );

  return v_hits <= p_max;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- Inscription idempotente. Appelée uniquement par l'Edge Function waitlist-join.
--   * email déjà présent : aucune écriture, renvoie la position et le code existants ;
--   * code de parrainage inconnu ou invalide : ignoré ;
--   * collision du code de parrainage généré : erreur « referral_code_collision »,
--     l'Edge Function réessaie avec un autre code.
create function public.waitlist_join(
  p_email             text,
  p_first_name        text,
  p_department        text,
  p_age_confirmed     boolean,
  p_terms_accepted    boolean,
  p_marketing_opt_in  boolean,
  p_legal_version     text,
  p_referral_code     text,
  p_new_referral_code text
)
returns table (queue_position bigint, code text, created boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_id       uuid;
  v_seq      bigint;
  v_code     text;
  v_created  boolean := false;
  v_referrer uuid;
  v_constraint text;
begin
  if p_terms_accepted is not true then
    raise exception 'terms_not_accepted' using errcode = '22023';
  end if;
  if p_age_confirmed is not true then
    raise exception 'age_not_confirmed' using errcode = '22023';
  end if;
  if p_legal_version is null or char_length(p_legal_version) not between 1 and 40 then
    raise exception 'invalid_legal_version' using errcode = '22023';
  end if;

  if p_referral_code is not null then
    select w.id into v_referrer
    from public.waitlist w
    where w.referral_code = upper(btrim(p_referral_code));
  end if;

  begin
    insert into public.waitlist as w (email, first_name, department, referral_code, referred_by, age_confirmed)
    values (p_email, p_first_name, nullif(p_department, ''), p_new_referral_code, v_referrer, p_age_confirmed)
    on conflict (email) do nothing
    returning w.id, w.signup_seq, w.referral_code into v_id, v_seq, v_code;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'waitlist_referral_code_key' then
      raise exception 'referral_code_collision' using errcode = 'P0001';
    end if;
    raise;
  end;

  if v_id is null then
    -- Réinscription : on ne modifie rien (ni prénom, ni consentements).
    select w.id, w.signup_seq, w.referral_code into v_id, v_seq, v_code
    from public.waitlist w
    where w.email = p_email;
  else
    v_created := true;
    insert into public.consents (waitlist_id, purpose, granted, document_version)
    values
      (v_id, 'terms_privacy', true, p_legal_version),
      (v_id, 'marketing_email', coalesce(p_marketing_opt_in, false), p_legal_version);
  end if;

  return query
    select (select count(*) from public.waitlist w2 where w2.signup_seq <= v_seq)::bigint, v_code, v_created;
end;
$$;

revoke all on function public.waitlist_join(text, text, text, boolean, boolean, boolean, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.waitlist_join(text, text, text, boolean, boolean, boolean, text, text, text)
  to service_role;

-- Effacement RGPD d'une inscription (et de ses consentements). Usage admin :
--   select public.waitlist_erase('adresse@exemple.fr');
create function public.waitlist_erase(p_email text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform set_config('stacker.erasure', 'on', true);
  delete from public.waitlist w where w.email = lower(btrim(p_email));
  get diagnostics v_count = row_count;
  perform set_config('stacker.erasure', 'off', true);
  return v_count > 0;
end;
$$;

revoke all on function public.waitlist_erase(text) from public, anon, authenticated, service_role;
grant execute on function public.waitlist_erase(text) to service_role;
