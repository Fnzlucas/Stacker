-- =============================================================================
-- Stacker — Lot 2 : comptes utilisateurs
--
-- Principes (audit/00_verdict_lead.md §1 et §2) :
--   * RLS activée ET forcée partout. Chaque stacker ne lit et ne modifie que
--     SA ligne de profiles, et seulement les colonnes déclaratives
--     (GRANT UPDATE par colonne + trigger de garde en défense en profondeur).
--   * Niveau, clients actifs, XP, déclaration de majorité, priorité de
--     lancement et fin d'onboarding : écrits uniquement côté serveur
--     (triggers et fonctions SECURITY DEFINER, search_path vide).
--   * Les critères de passage de niveau sont une CONFIGURATION serveur
--     (commission_tiers), marquée provisoire tant que Lucas ne les a pas fixés.
--   * Aucune date de naissance stockée : seulement l'horodatage de la
--     déclaration « je suis majeur ».
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Configuration des niveaux (paliers de commission)
-- -----------------------------------------------------------------------------

create table public.commission_tiers (
  code                 text primary key,
  label                text not null,
  -- Taux en points de base (1 500 = 15 %) : jamais de flottant pour de l'argent.
  rate_bps             integer not null,
  -- Critère : nombre de clients payants actifs (jamais l'XP, verdict C11).
  min_active_clients   integer not null,
  max_active_clients   integer,
  sort_order           smallint not null,
  -- true tant que Lucas n'a pas validé les seuils (verdict §4, action n° 6).
  criteria_provisional boolean not null default true,
  updated_at           timestamptz not null default now(),

  constraint commission_tiers_code_check check (code in ('rookie', 'pro', 'legend', 'elite')),
  constraint commission_tiers_rate_check check (rate_bps between 0 and 10000),
  constraint commission_tiers_range_check check (
    min_active_clients >= 0 and (max_active_clients is null or max_active_clients >= min_active_clients)
  ),
  constraint commission_tiers_sort_key unique (sort_order)
);

comment on table public.commission_tiers is
  'Paliers de commission. Lecture seule pour les stackers. Seuils PROVISOIRES tant que criteria_provisional = true.';

-- Ordre retenu par le Lead (C10) : Rookie < Pro < Legend < Elite.
-- Seuils provisoires proposés au verdict §4 n° 6, à confirmer par Lucas.
insert into public.commission_tiers (code, label, rate_bps, min_active_clients, max_active_clients, sort_order, criteria_provisional) values
  ('rookie', 'Rookie', 1500, 0, 2, 1, true),
  ('pro', 'Pro', 1800, 3, 9, 2, true),
  ('legend', 'Legend', 2200, 10, 24, 3, true),
  ('elite', 'Elite', 2500, 25, null, 4, true);

-- Niveau correspondant à un nombre de clients actifs (le plus haut atteint).
create function public.tier_for_active_clients(p_active_clients integer)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select t.code
  from public.commission_tiers t
  where t.min_active_clients <= greatest(coalesce(p_active_clients, 0), 0)
  order by t.sort_order desc
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- SIRET : 14 chiffres et clé de Luhn (exception La Poste : somme multiple de 5)
-- -----------------------------------------------------------------------------

create function public.siret_is_valid(p_siret text)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_sum   integer := 0;
  v_digit integer;
begin
  if p_siret !~ '^[0-9]{14}$' then
    return false;
  end if;
  if left(p_siret, 9) = '356000000' then
    for i in 1..14 loop
      v_sum := v_sum + substr(p_siret, i, 1)::integer;
    end loop;
    return v_sum % 5 = 0;
  end if;
  for i in 1..14 loop
    v_digit := substr(p_siret, 15 - i, 1)::integer;
    if i % 2 = 0 then
      v_digit := v_digit * 2;
      if v_digit > 9 then
        v_digit := v_digit - 9;
      end if;
    end if;
    v_sum := v_sum + v_digit;
  end loop;
  return v_sum % 10 = 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- Profils
-- -----------------------------------------------------------------------------

create table public.profiles (
  id                      uuid primary key references auth.users (id) on delete cascade,

  -- Champs déclaratifs, modifiables par le stacker (GRANT UPDATE par colonne).
  first_name              text,
  last_name               text,
  phone                   text,
  department              text,
  city                    text,
  legal_status            text,
  siret                   text,
  goal                    text,

  -- Champs serveur : jamais écrits par le navigateur.
  tier                    text not null default 'rookie' references public.commission_tiers (code),
  active_clients          integer not null default 0,
  xp                      integer not null default 0,
  adult_declared_at       timestamptz not null,
  launch_priority         boolean not null default false,
  waitlist_id             uuid references public.waitlist (id) on delete set null,
  waitlist_joined_at      timestamptz,
  onboarding_completed_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint profiles_first_name_format check (
    first_name is null or (first_name = btrim(first_name) and char_length(first_name) between 1 and 50)
  ),
  constraint profiles_last_name_format check (
    last_name is null or (last_name = btrim(last_name) and char_length(last_name) between 1 and 80)
  ),
  -- Format E.164 (le navigateur normalise « 06 12 34 56 78 » en « +33612345678»).
  constraint profiles_phone_format check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint profiles_department_format check (
    department is null
    or department ~ '^(0[1-9]|1[0-9]|2[1-9]|[3-8][0-9]|9[0-5]|2A|2B|97[1-46])$'
  ),
  constraint profiles_city_format check (
    city is null or (city = btrim(city) and char_length(city) between 1 and 80)
  ),
  constraint profiles_legal_status_check check (
    legal_status is null
    or legal_status in ('micro_entrepreneur', 'entreprise_individuelle', 'societe', 'sans_statut')
  ),
  constraint profiles_siret_check check (siret is null or public.siret_is_valid(siret)),
  constraint profiles_siret_requires_status check (
    siret is null or legal_status in ('micro_entrepreneur', 'entreprise_individuelle', 'societe')
  ),
  constraint profiles_goal_check check (
    goal is null or goal in ('complement', 'activite_principale', 'decouvrir')
  ),
  constraint profiles_counters_check check (active_clients >= 0 and xp >= 0)
);

comment on table public.profiles is
  'Profil stacker. Le stacker lit sa ligne et modifie ses champs déclaratifs ; le reste est écrit par le serveur.';
comment on column public.profiles.adult_declared_at is
  'Horodatage de la déclaration « je suis majeur » à l''inscription. Aucune date de naissance n''est conservée.';
comment on column public.profiles.launch_priority is
  'true si l''adresse confirmée figurait sur la liste d''attente : priorité conservée pour les vagues d''ouverture.';

create index profiles_waitlist_id_idx on public.profiles (waitlist_id) where waitlist_id is not null;
create index profiles_launch_priority_idx on public.profiles (waitlist_joined_at) where launch_priority;

-- Consentements des comptes : journal append-only, versionné (preuve RGPD).
create table public.user_consents (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users (id) on delete cascade,
  purpose          text not null,
  granted          boolean not null,
  document_version text not null,
  source           text not null default 'signup',
  created_at       timestamptz not null default now(),

  constraint user_consents_purpose_check check (purpose in ('terms_privacy', 'marketing_email')),
  constraint user_consents_document_version_check check (char_length(document_version) between 1 and 40),
  constraint user_consents_source_check check (char_length(source) between 1 and 40)
);

comment on table public.user_consents is
  'Journal append-only des consentements des comptes. Effacé uniquement avec le compte (cascade).';

create index user_consents_user_id_idx on public.user_consents (user_id);

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------

revoke all on table public.commission_tiers, public.profiles, public.user_consents
  from public, anon, authenticated, service_role;
revoke all on sequence public.user_consents_id_seq from public, anon, authenticated, service_role;

-- Le stacker lit les paliers et SA ligne de profil ; il ne modifie que les
-- colonnes déclaratives. Aucun INSERT ni DELETE (création par trigger,
-- suppression par la fonction serveur account-delete).
grant select on table public.commission_tiers to authenticated;
grant select on table public.profiles to authenticated;
grant update (first_name, last_name, phone, department, city, legal_status, siret, goal)
  on table public.profiles to authenticated;

alter table public.commission_tiers enable row level security;
alter table public.commission_tiers force row level security;
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.user_consents enable row level security;
alter table public.user_consents force row level security;

create policy commission_tiers_read on public.commission_tiers
  as permissive for select to authenticated using (true);

create policy profiles_select_own on public.profiles
  as permissive for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  as permissive for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Rôle propriétaire (fonctions SECURITY DEFINER, triggers) : voir lot 1.
create policy commission_tiers_owner_all on public.commission_tiers
  as permissive for all to postgres using (true) with check (true);
create policy profiles_owner_all on public.profiles
  as permissive for all to postgres using (true) with check (true);
create policy user_consents_owner_all on public.user_consents
  as permissive for all to postgres using (true) with check (true);

-- -----------------------------------------------------------------------------
-- Triggers de profiles
-- -----------------------------------------------------------------------------

-- Garde : même si un GRANT était élargi par erreur, un stacker ne peut pas
-- toucher aux champs serveur (niveau, XP, priorité, déclaration…).
create function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.id is distinct from old.id
       or new.tier is distinct from old.tier
       or new.active_clients is distinct from old.active_clients
       or new.xp is distinct from old.xp
       or new.adult_declared_at is distinct from old.adult_declared_at
       or new.launch_priority is distinct from old.launch_priority
       or new.waitlist_id is distinct from old.waitlist_id
       or new.waitlist_joined_at is distinct from old.waitlist_joined_at
       or new.onboarding_completed_at is distinct from old.onboarding_completed_at
       or new.created_at is distinct from old.created_at then
      raise exception 'profiles_server_field' using errcode = '42501',
        hint = 'Ce champ est calculé par le serveur.';
    end if;
  else
    -- Écriture serveur : le niveau est toujours dérivé des clients actifs,
    -- jamais posé à la main.
    new.tier := public.tier_for_active_clients(new.active_clients);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.profiles_guard() from public, anon, authenticated, service_role;

create trigger profiles_guard_row
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- Journal de consentements append-only. Seule exception : la suppression du
-- compte (cascade depuis auth.users, la ligne parente n'existe plus).
create function public.user_consents_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  raise exception 'user_consents_append_only' using errcode = '42501',
    hint = 'Le journal des consentements est append-only : ajoute une nouvelle ligne.';
end;
$$;

revoke all on function public.user_consents_append_only() from public, anon, authenticated, service_role;

create trigger user_consents_append_only_row
  before update or delete on public.user_consents
  for each row execute function public.user_consents_append_only();

create trigger user_consents_append_only_truncate
  before truncate on public.user_consents
  for each statement execute function public.user_consents_append_only();

-- -----------------------------------------------------------------------------
-- Lien avec la liste d'attente (à la confirmation de l'adresse uniquement :
-- on ne rattache jamais une priorité à une adresse non prouvée)
-- -----------------------------------------------------------------------------

create function public.link_waitlist(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.waitlist%rowtype;
begin
  select * into w from public.waitlist where email = lower(btrim(p_email));
  if not found then
    return;
  end if;
  update public.profiles p
  set waitlist_id        = w.id,
      launch_priority    = true,
      waitlist_joined_at = w.created_at,
      first_name         = coalesce(p.first_name, w.first_name),
      department         = coalesce(p.department, w.department)
  where p.id = p_user_id and p.waitlist_id is null;
end;
$$;

revoke all on function public.link_waitlist(uuid, text) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Création du profil à l'inscription (trigger sur auth.users)
--
-- Métadonnées attendues (envoyées par le formulaire d'inscription) :
--   adult_declared = true (obligatoire), terms_version (obligatoire),
--   marketing_opt_in (facultatif), first_name (facultatif).
-- Sans déclaration de majorité ni acceptation des CGU, l'inscription échoue.
-- -----------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta       jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_terms      text := nullif(btrim(coalesce(v_meta ->> 'terms_version', '')), '');
  v_first_name text := nullif(btrim(coalesce(v_meta ->> 'first_name', '')), '');
begin
  if coalesce(v_meta ->> 'adult_declared', '') <> 'true' then
    raise exception 'adult_declaration_required' using errcode = '22023';
  end if;
  if v_terms is null or char_length(v_terms) > 40 then
    raise exception 'terms_not_accepted' using errcode = '22023';
  end if;
  if v_first_name is not null and char_length(v_first_name) > 50 then
    v_first_name := null;
  end if;

  insert into public.profiles (id, first_name, adult_declared_at)
  values (new.id, v_first_name, now());

  insert into public.user_consents (user_id, purpose, granted, document_version)
  values
    (new.id, 'terms_privacy', true, v_terms),
    (new.id, 'marketing_email', coalesce(v_meta ->> 'marketing_opt_in', '') = 'true', v_terms);

  if new.email_confirmed_at is not null and new.email is not null then
    perform public.link_waitlist(new.id, new.email);
  end if;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.handle_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null and new.email is not null then
    perform public.link_waitlist(new.id, new.email);
  end if;
  return new;
end;
$$;

revoke all on function public.handle_user_email_confirmed() from public, anon, authenticated, service_role;

create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.handle_user_email_confirmed();

-- -----------------------------------------------------------------------------
-- Fonctions appelées par le stacker connecté
-- -----------------------------------------------------------------------------

-- Fin d'onboarding : prénom, département, objectif ; horodatage serveur.
create function public.complete_onboarding(p_first_name text, p_department text, p_goal text)
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
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if p_first_name is null or char_length(btrim(p_first_name)) not between 1 and 50 then
    raise exception 'invalid_first_name' using errcode = '22023';
  end if;

  update public.profiles p
  set first_name              = btrim(p_first_name),
      department              = nullif(btrim(coalesce(p_department, '')), ''),
      goal                    = nullif(btrim(coalesce(p_goal, '')), ''),
      onboarding_completed_at = coalesce(p.onboarding_completed_at, now())
  where p.id = v_uid;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.complete_onboarding(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.complete_onboarding(text, text, text) to authenticated;

-- Export RGPD (droit d'accès et à la portabilité) : uniquement les données
-- de l'appelant, au format JSON.
create function public.export_my_data()
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
    )
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.export_my_data() from public, anon, authenticated, service_role;
grant execute on function public.export_my_data() to authenticated;

-- -----------------------------------------------------------------------------
-- Effacement du compte (Edge Function account-delete, service_role)
-- Efface l'inscription à la liste d'attente rattachée au compte ; la
-- suppression de l'utilisateur (API admin Auth) emporte ensuite le profil et
-- les consentements par cascade. Idempotent.
-- -----------------------------------------------------------------------------

create function public.account_erase_prepare(p_user_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if p_user_id is null then
    raise exception 'invalid_user' using errcode = '22023';
  end if;
  select u.email into v_email from auth.users u where u.id = p_user_id;
  if not found then
    return false;
  end if;
  if v_email is not null then
    perform set_config('stacker.erasure', 'on', true);
    delete from public.waitlist w where w.email = lower(btrim(v_email));
    perform set_config('stacker.erasure', 'off', true);
  end if;
  return true;
end;
$$;

revoke all on function public.account_erase_prepare(uuid) from public, anon, authenticated, service_role;
grant execute on function public.account_erase_prepare(uuid) to service_role;

-- Si les seuils changent (décision de Lucas), chaque niveau est recalculé.
create function public.commission_tiers_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p
  set tier = public.tier_for_active_clients(p.active_clients)
  where p.tier is distinct from public.tier_for_active_clients(p.active_clients);
  return null;
end;
$$;

revoke all on function public.commission_tiers_changed() from public, anon, authenticated, service_role;

create trigger commission_tiers_recompute
  after insert or update or delete on public.commission_tiers
  for each statement execute function public.commission_tiers_changed();

-- Fonctions internes : aucun rôle client. siret_is_valid est pure et sert à
-- la contrainte CHECK évaluée sous le rôle qui écrit : elle reste exécutable.
revoke all on function public.tier_for_active_clients(integer) from public, anon, authenticated, service_role;
revoke all on function public.siret_is_valid(text) from public, anon, authenticated, service_role;
grant execute on function public.siret_is_valid(text) to authenticated, service_role;
