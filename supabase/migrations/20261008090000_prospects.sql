-- =============================================================================
-- Stacker — Lot 3 : prospection (onglet « Prospects »)
--
-- Spécification : audit/05_huntlist_integration.md §4 et §5.
--
-- Principes :
--   * Source des entreprises : API Recherche d'entreprises (SIRENE, Licence
--     Ouverte 2.0), appelée UNIQUEMENT par l'Edge Function prospects-search
--     (service_role). Cache mutualisé en base. Jamais Google Places.
--   * Une entreprise n'est suivie que par UN stacker à la fois (index unique
--     partiel) ; la réservation expire si rien ne se passe.
--   * Le stacker ne lit que SES réservations, notes, emails et événements. Il
--     n'écrit JAMAIS directement : tout passe par des fonctions SECURITY
--     DEFINER (search_path vide) qui contrôlent propriété, transitions,
--     quotas et opposition.
--   * « signe » n'est posé que par le serveur (création du deal).
--   * Liste d'opposition commune, hachée (HMAC-SHA256, poivre secret en base,
--     illisible par les rôles clients), appliquée avant tout affichage.
--   * Aucun envoi d'email par le serveur : l'email est préparé ici (modèle +
--     pied légal + lien d'opposition), le stacker l'envoie depuis SA boîte.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------

create type public.prospect_status as enum ('a_contacter', 'contacte', 'a_repondu', 'rdv', 'signe', 'pas_interesse');
create type public.prospect_release_reason as enum ('manuel', 'expire', 'pas_interesse', 'opposition', 'admin');
create type public.prospect_event_kind as enum (
  'reserve', 'statut', 'note', 'appel', 'email_prepare', 'email_envoye', 'prolonge', 'coordonnees', 'libere', 'expire', 'opposition', 'signe'
);
create type public.call_outcome as enum ('pas_de_reponse', 'messagerie', 'barrage', 'interesse', 'rappeler', 'pas_interesse');

-- -----------------------------------------------------------------------------
-- Réglages, interrupteurs et secrets
-- -----------------------------------------------------------------------------

create table public.prospect_settings (
  id                            boolean primary key default true,
  max_active_claims             integer not null default 40,
  max_new_claims_per_day        integer not null default 15,
  claim_ttl_days                integer not null default 10,
  ttl_contacted_days            integer not null default 21,
  ttl_rdv_days                  integer not null default 30,
  extend_days                   integer not null default 7,
  reclaim_block_days            integer not null default 30,
  cooldown_not_interested_days  integer not null default 180,
  max_claims_per_company_12m    integer not null default 3,
  searches_per_day              integer not null default 30,
  emails_prepared_per_day       integer not null default 40,
  -- Identité de l'éditeur reprise dans le pied de chaque email (art. 14 RGPD,
  -- identification de l'expéditeur réel). Modifiable par l'admin, jamais en dur
  -- dans les modèles.
  sender_entity                 text not null default 'Lucas Fernandez EI (Stacker), SIREN 891 139 248, 4 impasse Jean Roussière, 30400 Villeneuve-lès-Avignon',
  -- URL publique du site (liens d'opposition et de confidentialité).
  site_url                      text not null default 'https://stacker-topaz.vercel.app',
  updated_at                    timestamptz not null default now(),

  constraint prospect_settings_singleton check (id),
  constraint prospect_settings_positive check (
    max_active_claims > 0 and max_new_claims_per_day > 0 and claim_ttl_days > 0 and ttl_contacted_days > 0
    and ttl_rdv_days > 0 and extend_days > 0 and reclaim_block_days >= 0 and cooldown_not_interested_days >= 0
    and max_claims_per_company_12m > 0 and searches_per_day > 0 and emails_prepared_per_day > 0
  ),
  constraint prospect_settings_site_url check (site_url ~ '^https?://[^/[:space:]]+$'),
  constraint prospect_settings_sender check (char_length(sender_entity) between 10 and 300)
);
insert into public.prospect_settings default values;

comment on table public.prospect_settings is 'Règles de réservation, quotas et identité du pied d''email. Une seule ligne.';

-- Interrupteurs (coupe-circuit admin).
create table public.app_flags (
  key        text primary key,
  enabled    boolean not null,
  updated_at timestamptz not null default now(),
  constraint app_flags_key_check check (key ~ '^[a-z][a-z0-9_]{2,40}$')
);
insert into public.app_flags (key, enabled) values ('prospects_enabled', true);

-- Secrets internes (poivre HMAC de la liste d'opposition). Aucun rôle client,
-- ni service_role : seules les fonctions SECURITY DEFINER les lisent.
create table public.app_secrets (
  name  text primary key,
  value bytea not null
);
insert into public.app_secrets (name, value) values ('opposition_pepper', extensions.gen_random_bytes(32));

-- -----------------------------------------------------------------------------
-- Secteurs proposés (codes NAF), entreprises, cache de recherche
-- -----------------------------------------------------------------------------

create table public.naf_presets (
  key        text primary key,
  label      text not null,
  naf_codes  text[] not null,
  sort_order smallint not null unique,
  constraint naf_presets_key_check check (key ~ '^[a-z_]{3,30}$'),
  constraint naf_presets_codes_check check (
    cardinality(naf_codes) between 1 and 10
    and array_to_string(naf_codes, ',') ~ '^([0-9]{2}\.[0-9]{2}[A-Z])(,[0-9]{2}\.[0-9]{2}[A-Z])*$'
  )
);

-- Secteurs du lancement : entreprises locales qui ont besoin d'être visibles
-- (site, avis Google, réseaux sociaux). Professions réglementées exclues.
insert into public.naf_presets (key, label, naf_codes, sort_order) values
  ('batiment', 'Artisans du bâtiment', '{43.21A,43.22A,43.22B,43.31Z,43.32A,43.33Z,43.34Z,43.39Z,43.91B,43.99C}', 1),
  ('restauration', 'Restaurants et cafés', '{56.10A,56.10C,56.30Z}', 2),
  ('beaute', 'Coiffure et beauté', '{96.02A,96.02B,96.04Z}', 3),
  ('auto', 'Garages et auto', '{45.20A,45.20B,45.32Z,45.40Z}', 4),
  ('commerce', 'Commerces de proximité', '{10.71C,10.13B,47.76Z,47.71Z,47.29Z,47.22Z}', 5);

create table public.companies (
  siret          char(14) primary key,
  siren          char(9) not null,
  name           text not null,
  naf            text,
  naf_label      text,
  employee_band  text,
  legal_category text,
  is_sole_trader boolean not null default false,
  created_on     date,
  is_head_office boolean,
  address        text,
  postcode       text,
  city           text,
  department     text,
  latitude       numeric(9, 6),
  longitude      numeric(9, 6),
  -- Dirigeants : nom, prénoms, qualité seulement (jamais la date de naissance).
  officers       jsonb not null default '[]',
  source         text not null default 'api_recherche_entreprises',
  fetched_at     timestamptz not null default now(),

  constraint companies_siret_check check (siret ~ '^[0-9]{14}$'),
  constraint companies_siren_check check (siren ~ '^[0-9]{9}$' and left(siret, 9) = siren),
  constraint companies_name_check check (char_length(name) between 1 and 300),
  constraint companies_naf_check check (naf is null or naf ~ '^[0-9]{2}\.[0-9]{2}[A-Z]$'),
  constraint companies_officers_check check (jsonb_typeof(officers) = 'array' and jsonb_array_length(officers) <= 20)
);
create index companies_siren_idx on public.companies (siren);

comment on table public.companies is
  'Entreprises issues de SIRENE (API Recherche d''entreprises, Licence Ouverte 2.0). Lisibles par un stacker seulement s''il les a réservées.';

create table public.company_search_cache (
  key        text primary key,
  params     jsonb not null,
  sirets     text[] not null,
  total      integer not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint company_search_cache_key_check check (key ~ '^[0-9a-f]{64}$')
);
create index company_search_cache_expires_idx on public.company_search_cache (expires_at);

-- -----------------------------------------------------------------------------
-- Réservations, événements, notes, emails
-- -----------------------------------------------------------------------------

create table public.prospect_claims (
  id                 uuid primary key default gen_random_uuid(),
  stacker_id         uuid not null references auth.users (id) on delete cascade,
  siret              char(14) not null references public.companies (siret),
  status             public.prospect_status not null default 'a_contacter',
  claimed_at         timestamptz not null default now(),
  expires_at         timestamptz,
  extended           boolean not null default false,
  next_action_at     timestamptz,
  contact_phone      text,
  contact_email      text,
  contact_email_kind text,
  contact_source     text,
  released_at        timestamptz,
  release_reason     public.prospect_release_reason,
  signed_at          timestamptz,
  deal_ref           text,
  updated_at         timestamptz not null default now(),

  constraint prospect_claims_phone_check check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint prospect_claims_email_check check (
    contact_email is null or (contact_email = lower(contact_email) and char_length(contact_email) <= 254
      and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$')
  ),
  constraint prospect_claims_email_kind_check check (
    (contact_email is null and contact_email_kind is null)
    or (contact_email is not null and contact_email_kind in ('generique', 'nominatif'))
  ),
  constraint prospect_claims_source_check check (contact_source is null or char_length(contact_source) between 1 and 300),
  constraint prospect_claims_release_check check ((released_at is null) = (release_reason is null)),
  constraint prospect_claims_expiry_check check (status = 'signe' or released_at is not null or expires_at is not null),
  constraint prospect_claims_deal_ref_check check (deal_ref is null or char_length(deal_ref) <= 100)
);
create unique index prospect_claims_one_active on public.prospect_claims (siret) where released_at is null;
create index prospect_claims_stacker_active on public.prospect_claims (stacker_id) where released_at is null;
create index prospect_claims_expiry on public.prospect_claims (expires_at) where released_at is null;
create index prospect_claims_siret_hist on public.prospect_claims (siret, claimed_at);
create index prospect_claims_stacker_hist on public.prospect_claims (stacker_id, siret, released_at);

comment on table public.prospect_claims is
  'Réservation exclusive d''une entreprise par un stacker. Écriture uniquement via les fonctions prospect_*.';

create table public.prospect_events (
  id         bigint generated always as identity primary key,
  claim_id   uuid not null references public.prospect_claims (id) on delete cascade,
  stacker_id uuid not null,
  kind       public.prospect_event_kind not null,
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint prospect_events_payload_check check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 500)
);
create index prospect_events_claim_idx on public.prospect_events (claim_id, created_at);

create table public.prospect_notes (
  id         uuid primary key default gen_random_uuid(),
  claim_id   uuid not null references public.prospect_claims (id) on delete cascade,
  stacker_id uuid not null,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint prospect_notes_body_check check (body = btrim(body) and char_length(body) between 1 and 2000)
);
create index prospect_notes_claim_idx on public.prospect_notes (claim_id, created_at);

-- Modèles d'email (contenu validé, sans IA). Variables : {{entreprise}},
-- {{commune}}, {{prenom}}. La signature et le pied légal sont ajoutés par
-- prospect_prepare_email(), jamais par le modèle.
create table public.email_templates (
  key        text primary key,
  label      text not null,
  subject    text not null,
  body       text not null,
  sort_order smallint not null unique,
  active     boolean not null default true,
  constraint email_templates_key_check check (key ~ '^[a-z_]{3,30}$'),
  constraint email_templates_subject_check check (char_length(subject) between 5 and 120 and subject !~* '^(re|fwd?|tr)\s*:'),
  constraint email_templates_body_check check (char_length(body) between 40 and 1500)
);

insert into public.email_templates (key, label, subject, body, sort_order) values
  ('decouverte', 'Premier contact', '{{entreprise}} : votre visibilité à {{commune}}',
   E'Bonjour,\n\nJe m''appelle {{prenom}} et j''accompagne les entreprises de {{commune}} et des environs avec Stacker, qui réalise pour elles leur site internet, la gestion de leurs avis Google, leurs publications Instagram et leur visibilité sur Google.\n\nJe pense qu''il y a des choses simples à faire pour que vos futurs clients trouvent {{entreprise}} plus facilement en ligne.\n\nAuriez-vous quelques minutes cette semaine pour un court échange téléphonique ? Je vous présenterai ce que Stacker peut faire pour vous, et vous déciderez ensuite.',
   1),
  ('relance', 'Relance', '{{entreprise}} : je reviens vers vous',
   E'Bonjour,\n\nJe me permets de revenir vers vous au sujet de mon précédent message concernant la visibilité en ligne de {{entreprise}}.\n\nSi le sujet vous intéresse, je peux vous appeler au moment qui vous arrange. Et si ce n''est pas le bon moment, dites-le-moi simplement : je ne vous relancerai pas.',
   2),
  ('suite_appel', 'Après un appel', '{{entreprise}} : suite à notre échange',
   E'Bonjour,\n\nMerci pour le temps que vous m''avez accordé au téléphone.\n\nComme convenu, je reste à votre disposition pour répondre à vos questions sur les services de Stacker (site internet, avis Google, publications Instagram, visibilité sur Google) et pour vous accompagner dans la suite.\n\nN''hésitez pas à me répondre directement à ce message.',
   3);

create table public.prospect_emails (
  id               uuid primary key default gen_random_uuid(),
  claim_id         uuid not null references public.prospect_claims (id) on delete cascade,
  stacker_id       uuid not null,
  source           text not null default 'modele',
  template_key     text,
  recipient        text not null,
  subject          text not null,
  body             text not null,
  footer           text not null,
  opposition_token text not null,
  marked_sent_at   timestamptz,
  created_at       timestamptz not null default now(),
  constraint prospect_emails_source_check check (source in ('modele', 'ia')),
  constraint prospect_emails_subject_check check (char_length(subject) between 1 and 140),
  constraint prospect_emails_body_check check (char_length(body) between 1 and 2500),
  constraint prospect_emails_token_check check (opposition_token ~ '^[0-9a-f]{48}$')
);
create unique index prospect_emails_token_idx on public.prospect_emails (opposition_token);
create index prospect_emails_claim_idx on public.prospect_emails (claim_id, created_at);

-- -----------------------------------------------------------------------------
-- Opposition, gel, quotas
-- -----------------------------------------------------------------------------

create table public.opposition_list (
  id         bigint generated always as identity primary key,
  kind       text not null,
  value_hash bytea not null,
  source     text not null,
  created_at timestamptz not null default now(),
  constraint opposition_list_kind_check check (kind in ('siren', 'email', 'phone', 'domain')),
  constraint opposition_list_source_check check (source in ('lien', 'stacker', 'formulaire', 'admin')),
  constraint opposition_list_value_key unique (kind, value_hash)
);

comment on table public.opposition_list is
  'Personnes et entreprises qui ne veulent plus être contactées. Valeurs hachées (HMAC-SHA256) : aucune donnée en clair.';

create table public.company_cooldowns (
  siren  char(9) primary key,
  until  timestamptz not null,
  reason text not null,
  constraint company_cooldowns_reason_check check (reason in ('pas_interesse'))
);

create table public.usage_counters (
  user_id      uuid not null references auth.users (id) on delete cascade,
  metric       text not null,
  period       text not null,
  period_start date not null,
  count        integer not null default 0,
  primary key (user_id, metric, period, period_start),
  constraint usage_counters_metric_check check (metric in ('search', 'claim', 'email_prepared', 'ai_email', 'places')),
  constraint usage_counters_period_check check (period in ('day', 'month'))
);

-- -----------------------------------------------------------------------------
-- Droits et RLS
-- -----------------------------------------------------------------------------

revoke all on table
  public.prospect_settings, public.app_flags, public.app_secrets, public.naf_presets, public.companies,
  public.company_search_cache, public.prospect_claims, public.prospect_events, public.prospect_notes,
  public.email_templates, public.prospect_emails, public.opposition_list, public.company_cooldowns, public.usage_counters
  from public, anon, authenticated, service_role;
revoke all on sequence public.prospect_events_id_seq, public.opposition_list_id_seq from public, anon, authenticated, service_role;

-- Lecture seule pour le stacker connecté : réglages, secteurs, modèles, et SES lignes.
grant select on table public.prospect_settings, public.naf_presets, public.email_templates to authenticated;
grant select on table public.companies, public.prospect_claims, public.prospect_events, public.prospect_notes, public.prospect_emails to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'prospect_settings', 'app_flags', 'app_secrets', 'naf_presets', 'companies', 'company_search_cache', 'prospect_claims',
    'prospect_events', 'prospect_notes', 'email_templates', 'prospect_emails', 'opposition_list', 'company_cooldowns', 'usage_counters'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I as permissive for all to postgres using (true) with check (true)', t || '_owner_all', t);
  end loop;
end $$;

create policy prospect_settings_read on public.prospect_settings as permissive for select to authenticated using (true);
create policy naf_presets_read on public.naf_presets as permissive for select to authenticated using (true);
create policy email_templates_read on public.email_templates as permissive for select to authenticated using (active);

create policy prospect_claims_select_own on public.prospect_claims
  as permissive for select to authenticated using (stacker_id = (select auth.uid()));
create policy prospect_events_select_own on public.prospect_events
  as permissive for select to authenticated using (stacker_id = (select auth.uid()));
create policy prospect_notes_select_own on public.prospect_notes
  as permissive for select to authenticated using (stacker_id = (select auth.uid()));
create policy prospect_emails_select_own on public.prospect_emails
  as permissive for select to authenticated using (stacker_id = (select auth.uid()));
-- Une entreprise n'est lisible que par le stacker qui la suit (réservation active ou signée).
create policy companies_select_claimed on public.companies
  as permissive for select to authenticated using (
    exists (
      select 1 from public.prospect_claims c
      where c.siret = companies.siret and c.stacker_id = (select auth.uid()) and c.released_at is null
    )
  );

-- -----------------------------------------------------------------------------
-- Gardes : journal append-only, champs serveur
-- -----------------------------------------------------------------------------

create function public.prospect_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Seule exception : la suppression en cascade (compte ou réservation effacés).
  if tg_op = 'DELETE' and not exists (select 1 from public.prospect_claims c where c.id = old.claim_id) then
    return old;
  end if;
  raise exception 'prospect_events_append_only' using errcode = '42501';
end;
$$;
revoke all on function public.prospect_events_append_only() from public, anon, authenticated, service_role;

create trigger prospect_events_append_only_row
  before update or delete on public.prospect_events
  for each row execute function public.prospect_events_append_only();

create function public.prospect_claims_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.prospect_claims_touch() from public, anon, authenticated, service_role;

create trigger prospect_claims_touch_row
  before update on public.prospect_claims
  for each row execute function public.prospect_claims_touch();

-- -----------------------------------------------------------------------------
-- Fonctions internes (aucun rôle client)
-- -----------------------------------------------------------------------------

create function public.paris_today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Europe/Paris')::date $$;

create function public.app_flag(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select f.enabled from public.app_flags f where f.key = p_key), false) $$;

-- Valeur normalisée puis hachée (HMAC-SHA256 avec le poivre secret).
create function public.opposition_hash(p_kind text, p_value text)
returns bytea
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_norm text;
begin
  if p_value is null then
    return null;
  end if;
  v_norm := case p_kind
    when 'siren' then regexp_replace(p_value, '[^0-9]', '', 'g')
    when 'phone' then regexp_replace(p_value, '[^0-9+]', '', 'g')
    else lower(btrim(p_value))
  end;
  if v_norm = '' then
    return null;
  end if;
  return extensions.hmac(convert_to(p_kind || ':' || v_norm, 'UTF8'),
    (select s.value from public.app_secrets s where s.name = 'opposition_pepper'), 'sha256');
end;
$$;

create function public.email_domain(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$ select nullif(lower(split_part(btrim(coalesce(p_email, '')), '@', 2)), '') $$;

-- Domaines de messageries grand public : jamais inscrits en opposition « domaine »
-- (ce serait bloquer tous les clients d'un fournisseur).
create function public.is_public_mail_domain(p_domain text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_domain, '') in (
    'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr', 'live.com', 'live.fr',
    'msn.com', 'yahoo.com', 'yahoo.fr', 'icloud.com', 'me.com', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr',
    'neuf.fr', 'laposte.net', 'bbox.fr', 'aol.com', 'gmx.fr', 'gmx.com', 'protonmail.com', 'proton.me'
  )
$$;

create function public.is_opposed(p_siren text, p_email text, p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.opposition_list o
    where (o.kind = 'siren' and o.value_hash = public.opposition_hash('siren', p_siren))
       or (o.kind = 'email' and o.value_hash = public.opposition_hash('email', p_email))
       or (o.kind = 'phone' and o.value_hash = public.opposition_hash('phone', p_phone))
       or (o.kind = 'domain' and not public.is_public_mail_domain(public.email_domain(p_email))
           and o.value_hash = public.opposition_hash('domain', public.email_domain(p_email)))
  )
$$;

create function public.opposition_add(p_kind text, p_value text, p_source text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea := public.opposition_hash(p_kind, p_value);
begin
  if v_hash is null then
    return;
  end if;
  insert into public.opposition_list (kind, value_hash, source) values (p_kind, v_hash, p_source)
  on conflict (kind, value_hash) do nothing;
end;
$$;

-- Quota atomique : +1 si la limite n'est pas atteinte, sinon exception.
create function public.usage_consume(p_user uuid, p_metric text, p_limit_day integer, p_limit_month integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_day   date := public.paris_today();
  v_month date := date_trunc('month', public.paris_today())::date;
  v_count integer;
begin
  if p_user is null or p_metric is null then
    raise exception 'invalid_usage_arguments' using errcode = '22023';
  end if;
  if p_limit_day is not null then
    insert into public.usage_counters as u (user_id, metric, period, period_start, count)
    values (p_user, p_metric, 'day', v_day, 1)
    on conflict (user_id, metric, period, period_start) do update set count = u.count + 1
    returning u.count into v_count;
    if v_count > p_limit_day then
      raise exception 'daily_quota' using errcode = 'P0001';
    end if;
  end if;
  if p_limit_month is not null then
    insert into public.usage_counters as u (user_id, metric, period, period_start, count)
    values (p_user, p_metric, 'month', v_month, 1)
    on conflict (user_id, metric, period, period_start) do update set count = u.count + 1
    returning u.count into v_count;
    if v_count > p_limit_month then
      raise exception 'monthly_quota' using errcode = 'P0001';
    end if;
  end if;
  return v_count;
end;
$$;

create function public.usage_today(p_user uuid, p_metric text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select u.count from public.usage_counters u
    where u.user_id = p_user and u.metric = p_metric and u.period = 'day' and u.period_start = public.paris_today()
  ), 0)
$$;

create function public.prospect_log(p_claim uuid, p_stacker uuid, p_kind public.prospect_event_kind, p_payload jsonb default '{}')
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.prospect_events (claim_id, stacker_id, kind, payload) values (p_claim, p_stacker, p_kind, coalesce(p_payload, '{}'))
$$;

-- Libère une réservation active (événement compris). Renvoie false si déjà libérée.
create function public.prospect_release_internal(p_claim uuid, p_reason public.prospect_release_reason)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_stacker uuid;
begin
  update public.prospect_claims c
  set released_at = now(), release_reason = p_reason, next_action_at = null
  where c.id = p_claim and c.released_at is null and c.status <> 'signe'
  returning c.stacker_id into v_stacker;
  if not found then
    return false;
  end if;
  perform public.prospect_log(p_claim, v_stacker,
    case p_reason when 'expire' then 'expire'::public.prospect_event_kind
                  when 'opposition' then 'opposition'::public.prospect_event_kind
                  else 'libere'::public.prospect_event_kind end,
    jsonb_build_object('reason', p_reason));
  return true;
end;
$$;

-- Expire les réservations échues (d'un stacker, d'un SIRET, ou toutes).
create function public.prospect_expire_due(p_stacker uuid default null, p_siret text default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in
    select c.id from public.prospect_claims c
    where c.released_at is null and c.status <> 'signe' and c.expires_at <= now()
      and (p_stacker is null or c.stacker_id = p_stacker)
      and (p_siret is null or c.siret = p_siret)
    for update skip locked
  loop
    if public.prospect_release_internal(v_id, 'expire') then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Stacker connecté ET onboardé, sinon exception.
create function public.prospect_require_stacker()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.app_flag('prospects_enabled') then
    raise exception 'disabled' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.onboarding_completed_at is not null) then
    raise exception 'onboarding_required' using errcode = 'P0001';
  end if;
  return v_uid;
end;
$$;

-- Réservation active de l'appelant (verrouillée), sinon not_found.
create function public.prospect_own_active(p_claim uuid, p_uid uuid)
returns public.prospect_claims
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c public.prospect_claims%rowtype;
begin
  perform public.prospect_expire_due(p_uid, null);
  select * into c from public.prospect_claims x
  where x.id = p_claim and x.stacker_id = p_uid and x.released_at is null
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return c;
end;
$$;

-- Ordre des statuts (pour « au moins contacté »).
create function public.prospect_status_rank(p_status public.prospect_status)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status when 'a_contacter' then 0 when 'contacte' then 1 when 'a_repondu' then 2
                       when 'rdv' then 3 when 'signe' then 4 else -1 end
$$;

-- Matrice des transitions permises au stacker (audit 05 §5.1).
create function public.prospect_transition_allowed(p_from public.prospect_status, p_to public.prospect_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_to = 'pas_interesse' then p_from in ('a_contacter', 'contacte', 'a_repondu', 'rdv')
    when p_from = 'a_contacter' then p_to in ('contacte', 'a_repondu', 'rdv')
    when p_from = 'contacte' then p_to in ('contacte', 'a_repondu', 'rdv')
    when p_from = 'a_repondu' then p_to = 'rdv'
    when p_from = 'rdv' then p_to = 'a_repondu'
    else false
  end
$$;

-- Applique un statut (sans contrôle de droit : appelée après les contrôles).
create function public.prospect_apply_status(p_claim public.prospect_claims, p_status public.prospect_status, p_next_action_at timestamptz)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.prospect_settings%rowtype;
begin
  select * into s from public.prospect_settings;
  if p_status = 'pas_interesse' then
    update public.prospect_claims set status = 'pas_interesse' where id = p_claim.id;
    perform public.prospect_log(p_claim.id, p_claim.stacker_id, 'statut', jsonb_build_object('from', p_claim.status, 'to', p_status));
    perform public.prospect_release_internal(p_claim.id, 'pas_interesse');
    insert into public.company_cooldowns (siren, until, reason)
    values (left(p_claim.siret, 9), now() + make_interval(days => s.cooldown_not_interested_days), 'pas_interesse')
    on conflict (siren) do update set until = greatest(public.company_cooldowns.until, excluded.until), reason = excluded.reason;
    return;
  end if;
  update public.prospect_claims c
  set status = p_status,
      next_action_at = p_next_action_at,
      expires_at = greatest(c.expires_at, now() + make_interval(days => case
        when p_status = 'rdv' then s.ttl_rdv_days
        when public.prospect_status_rank(p_status) >= 1 then s.ttl_contacted_days
        else s.claim_ttl_days end))
  where c.id = p_claim.id;
  if p_status is distinct from p_claim.status then
    perform public.prospect_log(p_claim.id, p_claim.stacker_id, 'statut', jsonb_build_object('from', p_claim.status, 'to', p_status));
  end if;
end;
$$;

-- Classement d'une adresse : nominative si le local ressemble à prénom.nom,
-- ou contient le nom d'un dirigeant ; sinon générique.
create function public.email_kind(p_email text, p_officers jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_local text := lower(split_part(coalesce(p_email, ''), '@', 1));
  v_o     jsonb;
  v_part  text;
begin
  if v_local ~ '^(contact|info|infos|accueil|bonjour|hello|devis|commercial|commandes?|reservations?|secretariat|administration|direction|bureau|atelier|agence|boutique|magasin|service|sav|compta|facturation|rh|recrutement|mairie|office)([._-]?[a-z0-9]*)?$' then
    return 'generique';
  end if;
  if v_local ~ '^[a-z]+[._-][a-z]+([._-][a-z]+)?$' or v_local ~ '^[a-z][._-][a-z]{2,}$' then
    return 'nominatif';
  end if;
  for v_o in select * from jsonb_array_elements(coalesce(p_officers, '[]'::jsonb)) loop
    foreach v_part in array regexp_split_to_array(lower(coalesce(v_o ->> 'nom', '') || ' ' || coalesce(v_o ->> 'prenoms', '')), '[^a-z]+') loop
      if char_length(v_part) >= 3 and position(v_part in v_local) > 0 then
        return 'nominatif';
      end if;
    end loop;
  end loop;
  return 'generique';
end;
$$;

-- -----------------------------------------------------------------------------
-- Fonctions du stacker connecté
-- -----------------------------------------------------------------------------

create function public.prospect_claim(p_siret text)
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
  if p_siret is null or p_siret !~ '^[0-9]{14}$' then
    raise exception 'invalid_siret' using errcode = '22023';
  end if;
  select * into s from public.prospect_settings;
  if not exists (select 1 from public.companies c where c.siret = p_siret) then
    raise exception 'unknown_company' using errcode = 'P0002';
  end if;
  v_siren := left(p_siret, 9);

  -- Une réservation échue libère la place avant tout contrôle.
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
      where c.stacker_id = v_uid and c.released_at is null and c.status <> 'signe') >= s.max_active_claims then
    raise exception 'max_active' using errcode = 'P0001';
  end if;

  perform public.usage_consume(v_uid, 'claim', s.max_new_claims_per_day, null);

  begin
    insert into public.prospect_claims (stacker_id, siret, expires_at)
    values (v_uid, p_siret, now() + make_interval(days => s.claim_ttl_days))
    returning id into v_id;
  exception when unique_violation then
    -- Deux stackers au même instant : un seul gagne.
    raise exception 'already_claimed' using errcode = 'P0001';
  end;
  perform public.prospect_log(v_id, v_uid, 'reserve');
  return v_id;
end;
$$;

create function public.prospect_set_status(p_claim uuid, p_status public.prospect_status, p_next_action_at timestamptz default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.prospect_require_stacker();
  c     public.prospect_claims%rowtype;
begin
  if p_status in ('signe', 'a_contacter') then
    raise exception 'forbidden_status' using errcode = '42501';
  end if;
  c := public.prospect_own_active(p_claim, v_uid);
  if not public.prospect_transition_allowed(c.status, p_status) then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  if p_next_action_at is not null and (p_next_action_at < now() - interval '1 day' or p_next_action_at > now() + interval '120 days') then
    raise exception 'invalid_next_action' using errcode = '22023';
  end if;
  perform public.prospect_apply_status(c, p_status, p_next_action_at);
end;
$$;

create function public.prospect_set_contact(p_claim uuid, p_phone text, p_email text, p_source text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := public.prospect_require_stacker();
  c         public.prospect_claims%rowtype;
  v_phone   text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email   text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_source  text := nullif(btrim(coalesce(p_source, '')), '');
  v_kind    text;
  v_officers jsonb;
begin
  c := public.prospect_own_active(p_claim, v_uid);
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$') then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if (v_phone is not null or v_email is not null) and (v_source is null or char_length(v_source) > 300) then
    raise exception 'source_required' using errcode = '22023';
  end if;
  if public.is_opposed(null, v_email, v_phone) then
    raise exception 'opposed' using errcode = 'P0001';
  end if;
  if v_email is not null then
    select co.officers into v_officers from public.companies co where co.siret = c.siret;
    v_kind := public.email_kind(v_email, v_officers);
  end if;
  update public.prospect_claims
  set contact_phone = v_phone, contact_email = v_email, contact_email_kind = v_kind,
      contact_source = case when v_phone is null and v_email is null then null else v_source end
  where id = c.id;
  perform public.prospect_log(c.id, v_uid, 'coordonnees',
    jsonb_build_object('phone', v_phone is not null, 'email', v_email is not null, 'email_kind', v_kind));
  return v_kind;
end;
$$;

create function public.prospect_add_note(p_claim uuid, p_body text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := public.prospect_require_stacker();
  c      public.prospect_claims%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_id   uuid;
begin
  c := public.prospect_own_active(p_claim, v_uid);
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;
  if (select count(*) from public.prospect_notes n where n.claim_id = c.id) >= 200 then
    raise exception 'too_many_notes' using errcode = 'P0001';
  end if;
  insert into public.prospect_notes (claim_id, stacker_id, body) values (c.id, v_uid, v_body) returning id into v_id;
  perform public.prospect_log(c.id, v_uid, 'note');
  return v_id;
end;
$$;

create function public.prospect_delete_note(p_note uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.prospect_require_stacker();
begin
  delete from public.prospect_notes n where n.id = p_note and n.stacker_id = v_uid;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.prospect_log_call(p_claim uuid, p_outcome public.call_outcome, p_next_action_at timestamptz default null)
returns public.prospect_status
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.prospect_require_stacker();
  c     public.prospect_claims%rowtype;
  v_to  public.prospect_status;
begin
  if p_outcome is null then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  if p_next_action_at is not null and (p_next_action_at < now() - interval '1 day' or p_next_action_at > now() + interval '120 days') then
    raise exception 'invalid_next_action' using errcode = '22023';
  end if;
  c := public.prospect_own_active(p_claim, v_uid);
  perform public.prospect_log(c.id, v_uid, 'appel', jsonb_build_object('outcome', p_outcome));
  v_to := case
    when p_outcome = 'pas_interesse' then 'pas_interesse'::public.prospect_status
    when p_outcome = 'interesse' and public.prospect_status_rank(c.status) < 2 then 'a_repondu'::public.prospect_status
    when c.status = 'a_contacter' then 'contacte'::public.prospect_status
    else c.status
  end;
  perform public.prospect_apply_status(c, v_to, coalesce(p_next_action_at, case when v_to = 'pas_interesse' then null else c.next_action_at end));
  return v_to;
end;
$$;

create function public.prospect_extend(p_claim uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.prospect_require_stacker();
  c     public.prospect_claims%rowtype;
  v_exp timestamptz;
begin
  c := public.prospect_own_active(p_claim, v_uid);
  if c.extended then
    raise exception 'already_extended' using errcode = 'P0001';
  end if;
  if public.prospect_status_rank(c.status) < 1 then
    raise exception 'too_early' using errcode = 'P0001';
  end if;
  update public.prospect_claims x
  set extended = true, expires_at = x.expires_at + make_interval(days => (select s.extend_days from public.prospect_settings s))
  where x.id = c.id
  returning x.expires_at into v_exp;
  perform public.prospect_log(c.id, v_uid, 'prolonge');
  return v_exp;
end;
$$;

-- Libération par le stacker. « opposition » : l'entreprise (et les
-- coordonnées saisies) ne veulent plus être contactées, par personne.
create function public.prospect_release(p_claim uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.prospect_require_stacker();
  c     public.prospect_claims%rowtype;
begin
  if p_reason not in ('manuel', 'opposition') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  c := public.prospect_own_active(p_claim, v_uid);
  if p_reason = 'opposition' then
    perform public.opposition_register_claim(c.id, 'stacker');
  else
    perform public.prospect_release_internal(c.id, 'manuel');
  end if;
end;
$$;

-- Prépare un email à partir d'un modèle : texte, signature, pied légal et
-- jeton d'opposition sont produits ICI. Le stacker l'envoie de sa boîte.
create function public.prospect_prepare_email(p_claim uuid, p_template_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := public.prospect_require_stacker();
  c         public.prospect_claims%rowtype;
  s         public.prospect_settings%rowtype;
  t         public.email_templates%rowtype;
  co        public.companies%rowtype;
  p         public.profiles%rowtype;
  v_name    text;
  v_city    text;
  v_subject text;
  v_body    text;
  v_footer  text;
  v_token   text := encode(extensions.gen_random_bytes(24), 'hex');
  v_id      uuid;
begin
  c := public.prospect_own_active(p_claim, v_uid);
  if c.contact_email is null then
    raise exception 'no_email' using errcode = 'P0001';
  end if;
  if public.is_opposed(left(c.siret, 9), c.contact_email, null) then
    raise exception 'opposed' using errcode = 'P0001';
  end if;
  select * into p from public.profiles x where x.id = v_uid;
  if p.first_name is null or p.last_name is null then
    -- L'expéditeur réel doit être identifiable (prénom ET nom).
    raise exception 'profile_incomplete' using errcode = 'P0001';
  end if;
  select * into t from public.email_templates x where x.key = p_template_key and x.active;
  if not found then
    raise exception 'unknown_template' using errcode = '22023';
  end if;
  select * into s from public.prospect_settings;
  select * into co from public.companies x where x.siret = c.siret;

  perform public.usage_consume(v_uid, 'email_prepared', s.emails_prepared_per_day, null);

  v_name := co.name;
  v_city := coalesce(initcap(lower(co.city)), 'votre secteur');
  v_subject := replace(replace(replace(t.subject, '{{entreprise}}', v_name), '{{commune}}', v_city), '{{prenom}}', p.first_name);
  v_subject := left(v_subject, 140);
  v_body := replace(replace(replace(t.body, '{{entreprise}}', v_name), '{{commune}}', v_city), '{{prenom}}', p.first_name)
    || E'\n\nBien cordialement,\n' || p.first_name || ' ' || p.last_name
    || case when p.phone is not null then E'\n' || p.phone else '' end;
  v_footer := p.first_name || ' ' || p.last_name || ', apporteur d''affaires indépendant pour Stacker — ' || s.sender_entity || E'.\n'
    || E'Je vous écris à l''adresse professionnelle publiée par votre entreprise ; les informations sur votre entreprise proviennent de la base SIRENE (INSEE).\n'
    || 'Pour ne plus être contacté par Stacker : ' || s.site_url || '/opposition?t=' || v_token || E'\n'
    || 'Vos droits : ' || s.site_url || '/confidentialite';

  insert into public.prospect_emails (claim_id, stacker_id, source, template_key, recipient, subject, body, footer, opposition_token)
  values (c.id, v_uid, 'modele', t.key, c.contact_email, v_subject, v_body, v_footer, v_token)
  returning id into v_id;
  perform public.prospect_log(c.id, v_uid, 'email_prepare', jsonb_build_object('template', t.key));

  return jsonb_build_object('id', v_id, 'recipient', c.contact_email, 'subject', v_subject, 'body', v_body, 'footer', v_footer);
end;
$$;

create function public.prospect_mark_email_sent(p_email uuid)
returns public.prospect_status
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := public.prospect_require_stacker();
  e       public.prospect_emails%rowtype;
  c       public.prospect_claims%rowtype;
begin
  select * into e from public.prospect_emails x where x.id = p_email and x.stacker_id = v_uid for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  c := public.prospect_own_active(e.claim_id, v_uid);
  if e.marked_sent_at is null then
    update public.prospect_emails set marked_sent_at = now() where id = e.id;
    perform public.prospect_log(c.id, v_uid, 'email_envoye', jsonb_build_object('email_id', e.id));
  end if;
  if c.status = 'a_contacter' then
    perform public.prospect_apply_status(c, 'contacte', c.next_action_at);
    return 'contacte';
  end if;
  -- Relance : la réservation reste vivante au moins le délai « contacté ».
  perform public.prospect_apply_status(c, c.status, c.next_action_at);
  return c.status;
end;
$$;

-- Liste de MES prospects (réservations actives et signées), avec l'essentiel de l'entreprise.
create function public.my_prospects()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.prospect_require_stacker();
begin
  perform public.prospect_expire_due(v_uid, null);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'siret', c.siret, 'status', c.status, 'claimed_at', c.claimed_at, 'expires_at', c.expires_at,
      'next_action_at', c.next_action_at, 'has_phone', c.contact_phone is not null, 'has_email', c.contact_email is not null,
      'name', co.name, 'naf_label', co.naf_label, 'city', co.city, 'postcode', co.postcode
    ) order by c.next_action_at nulls last, c.expires_at nulls last, c.claimed_at desc)
    from public.prospect_claims c join public.companies co on co.siret = c.siret
    where c.stacker_id = v_uid and c.released_at is null
  ), '[]'::jsonb);
end;
$$;

create function public.prospect_detail(p_claim uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.prospect_require_stacker();
  c     public.prospect_claims%rowtype;
  co    public.companies%rowtype;
begin
  perform public.prospect_expire_due(v_uid, null);
  select * into c from public.prospect_claims x where x.id = p_claim and x.stacker_id = v_uid and x.released_at is null;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into co from public.companies x where x.siret = c.siret;
  return jsonb_build_object(
    'claim', jsonb_build_object(
      'id', c.id, 'status', c.status, 'claimed_at', c.claimed_at, 'expires_at', c.expires_at, 'extended', c.extended,
      'next_action_at', c.next_action_at, 'contact_phone', c.contact_phone, 'contact_email', c.contact_email,
      'contact_email_kind', c.contact_email_kind, 'contact_source', c.contact_source
    ),
    'company', jsonb_build_object(
      'siret', co.siret, 'siren', co.siren, 'name', co.name, 'naf', co.naf, 'naf_label', co.naf_label,
      'employee_band', co.employee_band, 'is_sole_trader', co.is_sole_trader, 'created_on', co.created_on,
      'address', co.address, 'postcode', co.postcode, 'city', co.city, 'officers', co.officers
    ),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at) order by n.created_at desc)
                       from public.prospect_notes n where n.claim_id = c.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'payload', e.payload, 'created_at', e.created_at) order by e.id desc)
                        from (select * from public.prospect_events e where e.claim_id = c.id order by e.id desc limit 50) e), '[]'::jsonb),
    'emails', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'template_key', m.template_key, 'subject', m.subject,
                                                             'marked_sent_at', m.marked_sent_at, 'created_at', m.created_at) order by m.created_at desc)
                        from public.prospect_emails m where m.claim_id = c.id), '[]'::jsonb)
  );
end;
$$;

create function public.my_prospect_quotas()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s     public.prospect_settings%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into s from public.prospect_settings;
  return jsonb_build_object(
    'enabled', public.app_flag('prospects_enabled'),
    'searches', jsonb_build_object('used', public.usage_today(v_uid, 'search'), 'limit', s.searches_per_day),
    'claims_today', jsonb_build_object('used', public.usage_today(v_uid, 'claim'), 'limit', s.max_new_claims_per_day),
    'emails_today', jsonb_build_object('used', public.usage_today(v_uid, 'email_prepared'), 'limit', s.emails_prepared_per_day),
    'active', jsonb_build_object(
      'used', (select count(*) from public.prospect_claims c where c.stacker_id = v_uid and c.released_at is null and c.status <> 'signe'),
      'limit', s.max_active_claims)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Opposition (service_role : Edge Function opposition-register)
-- -----------------------------------------------------------------------------

-- Inscrit l'entreprise et les coordonnées d'une réservation, puis libère
-- toutes les réservations actives de l'entreprise.
create function public.opposition_register_claim(p_claim uuid, p_source text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c    public.prospect_claims%rowtype;
  v_id uuid;
begin
  select * into c from public.prospect_claims x where x.id = p_claim;
  if not found then
    return;
  end if;
  perform public.opposition_add('siren', left(c.siret, 9), p_source);
  perform public.opposition_add('email', c.contact_email, p_source);
  perform public.opposition_add('phone', c.contact_phone, p_source);
  if c.contact_email_kind = 'generique' and not public.is_public_mail_domain(public.email_domain(c.contact_email)) then
    perform public.opposition_add('domain', public.email_domain(c.contact_email), p_source);
  end if;
  for v_id in select x.id from public.prospect_claims x where left(x.siret, 9) = left(c.siret, 9) and x.released_at is null and x.status <> 'signe' loop
    perform public.prospect_release_internal(v_id, 'opposition');
  end loop;
end;
$$;

-- Lien du pied d'email. Réponse identique que le jeton soit bon ou non
-- (pas d'énumération) : la fonction renvoie seulement si une action a eu lieu.
create function public.opposition_register_token(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e public.prospect_emails%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then
    return false;
  end if;
  select * into e from public.prospect_emails x where x.opposition_token = p_token and x.created_at > now() - interval '2 years';
  if not found then
    return false;
  end if;
  perform public.opposition_add('email', e.recipient, 'lien');
  perform public.opposition_register_claim(e.claim_id, 'lien');
  return true;
end;
$$;

-- Formulaire public : SIREN et/ou email.
create function public.opposition_register_form(p_siren text, p_email text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_siren text := nullif(regexp_replace(coalesce(p_siren, ''), '[^0-9]', '', 'g'), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_id    uuid;
begin
  if v_siren is not null and v_siren !~ '^[0-9]{9}$' then
    raise exception 'invalid_siren' using errcode = '22023';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$') then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if v_siren is null and v_email is null then
    raise exception 'empty' using errcode = '22023';
  end if;
  perform public.opposition_add('siren', v_siren, 'formulaire');
  perform public.opposition_add('email', v_email, 'formulaire');
  for v_id in
    select x.id from public.prospect_claims x
    where x.released_at is null and x.status <> 'signe'
      and ((v_siren is not null and left(x.siret, 9) = v_siren) or (v_email is not null and x.contact_email = v_email))
  loop
    perform public.prospect_release_internal(v_id, 'opposition');
  end loop;
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Recherche (service_role : Edge Function prospects-search)
-- -----------------------------------------------------------------------------

-- Contrôles avant une recherche : compte onboardé, interrupteur, quota du jour.
-- Renvoie le département du profil (zone par défaut).
create function public.prospects_search_begin(p_user uuid)
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
  v_used := public.usage_consume(p_user, 'search', v_limit, null);
  return jsonb_build_object('used', v_used, 'limit', v_limit);
end;
$$;

create function public.prospects_cache_get(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('sirets', to_jsonb(k.sirets), 'total', k.total)
  from public.company_search_cache k where k.key = p_key and k.expires_at > now()
$$;

-- Enregistre une page de résultats : entreprises (upsert) puis cache 7 jours.
create function public.prospects_cache_put(p_key text, p_params jsonb, p_total integer, p_companies jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sirets text[];
begin
  if p_key !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_companies) <> 'array' or jsonb_array_length(p_companies) > 25 then
    raise exception 'invalid_cache_entry' using errcode = '22023';
  end if;
  insert into public.companies as co (
    siret, siren, name, naf, naf_label, employee_band, legal_category, is_sole_trader, created_on, is_head_office,
    address, postcode, city, department, latitude, longitude, officers, fetched_at
  )
  select distinct on (x.siret) x.siret, left(x.siret, 9), x.name, x.naf, x.naf_label, x.employee_band, x.legal_category, coalesce(x.is_sole_trader, false),
         x.created_on, x.is_head_office, x.address, x.postcode, x.city, x.department, x.latitude, x.longitude,
         coalesce(x.officers, '[]'::jsonb), now()
  from jsonb_to_recordset(p_companies) as x(
    siret text, name text, naf text, naf_label text, employee_band text, legal_category text, is_sole_trader boolean,
    created_on date, is_head_office boolean, address text, postcode text, city text, department text,
    latitude numeric, longitude numeric, officers jsonb)
  on conflict (siret) do update set
    name = excluded.name, naf = excluded.naf, naf_label = excluded.naf_label, employee_band = excluded.employee_band,
    legal_category = excluded.legal_category, is_sole_trader = excluded.is_sole_trader, created_on = excluded.created_on,
    is_head_office = excluded.is_head_office, address = excluded.address, postcode = excluded.postcode, city = excluded.city,
    department = excluded.department, latitude = excluded.latitude, longitude = excluded.longitude,
    officers = excluded.officers, fetched_at = now();

  select coalesce(array_agg(x.siret order by x.first_ord), '{}') into v_sirets
  from (
    select e.v ->> 'siret' as siret, min(e.ord) as first_ord
    from jsonb_array_elements(p_companies) with ordinality as e(v, ord)
    group by e.v ->> 'siret'
  ) x;

  insert into public.company_search_cache (key, params, sirets, total, fetched_at, expires_at)
  values (p_key, coalesce(p_params, '{}'::jsonb), v_sirets, greatest(coalesce(p_total, 0), 0), now(), now() + interval '7 days')
  on conflict (key) do update set params = excluded.params, sirets = excluded.sirets, total = excluded.total,
    fetched_at = excluded.fetched_at, expires_at = excluded.expires_at;
end;
$$;

-- Résultats affichables pour un stacker : opposés retirés, état de chaque
-- entreprise (libre, à moi, déjà suivie, en pause). Aucune info sur l'autre stacker.
create function public.prospects_annotate(p_user uuid, p_sirets text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.prospect_expire_due(null, s) from unnest(p_sirets) s;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'siret', co.siret, 'name', co.name, 'naf', co.naf, 'naf_label', co.naf_label, 'city', co.city, 'postcode', co.postcode,
      'employee_band', co.employee_band, 'created_on', co.created_on, 'is_head_office', co.is_head_office,
      'is_sole_trader', co.is_sole_trader,
      'state', case
        when mine.id is not null then 'a_moi'
        when other.id is not null then 'deja_suivie'
        when k.until > now() then 'en_pause'
        else 'libre' end,
      'claim_id', mine.id,
      'cooldown_until', case when k.until > now() then k.until end
    ) order by t.ord)
    from unnest(p_sirets) with ordinality as t(siret, ord)
    join public.companies co on co.siret = t.siret
    left join public.company_cooldowns k on k.siren = co.siren
    left join public.prospect_claims mine on mine.siret = co.siret and mine.released_at is null and mine.stacker_id = p_user
    left join public.prospect_claims other on other.siret = co.siret and other.released_at is null and other.stacker_id <> p_user
    where not public.is_opposed(co.siren, null, null)
  ), '[]'::jsonb);
end;
$$;

-- Seule voie vers « signé » (création du deal, lot suivant ; ou admin).
create function public.prospect_mark_signed(p_claim uuid, p_deal_ref text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c public.prospect_claims%rowtype;
begin
  select * into c from public.prospect_claims x where x.id = p_claim and x.released_at is null for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.prospect_claims
  set status = 'signe', signed_at = now(), deal_ref = left(p_deal_ref, 100), expires_at = null, next_action_at = null
  where id = c.id;
  perform public.prospect_log(c.id, c.stacker_id, 'signe', jsonb_build_object('from', c.status));
end;
$$;

-- -----------------------------------------------------------------------------
-- Tâches planifiées (pg_cron sur Supabase ; appelables à la main ailleurs)
-- -----------------------------------------------------------------------------

create function public.prospect_jobs_purge()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from public.company_search_cache where expires_at < now();
  delete from public.usage_counters where period_start < public.paris_today() - 40;
  delete from public.company_cooldowns where until < now();
  -- RGPD : 3 ans après la libération, la réservation (coordonnées, notes,
  -- emails, événements en cascade) est effacée.
  delete from public.prospect_claims where released_at < now() - interval '3 years';
  -- Entreprises plus suivies par personne et non rafraîchies depuis 90 jours.
  delete from public.companies co
  where co.fetched_at < now() - interval '90 days'
    and not exists (select 1 from public.prospect_claims c where c.siret = co.siret);
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('prospects-expire', '*/15 * * * *', 'select public.prospect_expire_due()');
    perform cron.schedule('prospects-purge', '0 3 * * *', 'select public.prospect_jobs_purge()');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Export RGPD : les données de prospection du stacker en font partie
-- -----------------------------------------------------------------------------

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
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- Droits d'exécution
-- -----------------------------------------------------------------------------

revoke all on function
  public.paris_today(), public.app_flag(text), public.opposition_hash(text, text), public.email_domain(text),
  public.is_public_mail_domain(text), public.is_opposed(text, text, text), public.opposition_add(text, text, text),
  public.usage_consume(uuid, text, integer, integer), public.usage_today(uuid, text),
  public.prospect_log(uuid, uuid, public.prospect_event_kind, jsonb),
  public.prospect_release_internal(uuid, public.prospect_release_reason), public.prospect_expire_due(uuid, text),
  public.prospect_require_stacker(), public.prospect_own_active(uuid, uuid), public.prospect_status_rank(public.prospect_status),
  public.prospect_transition_allowed(public.prospect_status, public.prospect_status),
  public.prospect_apply_status(public.prospect_claims, public.prospect_status, timestamptz), public.email_kind(text, jsonb),
  public.prospect_claim(text), public.prospect_set_status(uuid, public.prospect_status, timestamptz),
  public.prospect_set_contact(uuid, text, text, text), public.prospect_add_note(uuid, text), public.prospect_delete_note(uuid),
  public.prospect_log_call(uuid, public.call_outcome, timestamptz), public.prospect_extend(uuid), public.prospect_release(uuid, text),
  public.prospect_prepare_email(uuid, text), public.prospect_mark_email_sent(uuid), public.my_prospects(),
  public.prospect_detail(uuid), public.my_prospect_quotas(), public.opposition_register_claim(uuid, text),
  public.opposition_register_token(text), public.opposition_register_form(text, text), public.prospects_search_begin(uuid),
  public.prospects_cache_get(text), public.prospects_cache_put(text, jsonb, integer, jsonb), public.prospects_annotate(uuid, text[]),
  public.prospect_mark_signed(uuid, text), public.prospect_jobs_purge(), public.prospect_events_append_only(),
  public.prospect_claims_touch()
  from public, anon, authenticated, service_role;

-- Stacker connecté.
grant execute on function
  public.prospect_claim(text), public.prospect_set_status(uuid, public.prospect_status, timestamptz),
  public.prospect_set_contact(uuid, text, text, text), public.prospect_add_note(uuid, text), public.prospect_delete_note(uuid),
  public.prospect_log_call(uuid, public.call_outcome, timestamptz), public.prospect_extend(uuid), public.prospect_release(uuid, text),
  public.prospect_prepare_email(uuid, text), public.prospect_mark_email_sent(uuid), public.my_prospects(),
  public.prospect_detail(uuid), public.my_prospect_quotas()
  to authenticated;

-- Edge Functions (service_role).
grant execute on function
  public.prospects_search_begin(uuid), public.prospects_cache_get(text), public.prospects_cache_put(text, jsonb, integer, jsonb),
  public.prospects_annotate(uuid, text[]), public.opposition_register_token(text), public.opposition_register_form(text, text),
  public.prospect_mark_signed(uuid, text), public.prospect_expire_due(uuid, text), public.prospect_jobs_purge()
  to service_role;

-- Fonctions pures utilisées dans des politiques ou contraintes : aucune.
