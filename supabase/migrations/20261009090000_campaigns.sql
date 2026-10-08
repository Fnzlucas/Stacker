-- =============================================================================
-- Stacker — Lot 3 bis : campagnes d'emails (volume) et moteur de prospection
--
-- Objectif (Lucas, 8/10) : un stacker envoie jusqu'à 200 emails par jour sans
-- réserver les entreprises une par une.
--
--   * Le stacker lance UNE campagne (département, secteur, volume, modèle).
--     Chaque jour, le serveur choisit les entreprises (email générique connu,
--     non opposées, non suivies, non sollicitées récemment), les réserve en
--     bloc pour ce stacker et prépare les emails (pied légal serveur, lien
--     d'opposition). Aucun clic par entreprise.
--   * Les emails partent DEPUIS LA BOÎTE du stacker (Gmail ou Outlook
--     connectés par OAuth, envoi seulement), étalés en semaine de 8 h 30 à
--     18 h 30, avec une montée progressive (20 → 200 par jour en 3 semaines)
--     pour ne pas être classés en spam.
--   * Les emails des entreprises sont trouvés par le serveur (moteur
--     Huntlist : Google Maps → site de l'entreprise → adresse générique
--     publiée → SIRENE). On ne conserve AUCUN contenu Google : seulement le
--     place_id (autorisé sans limite de durée), l'entreprise SIRENE et
--     l'adresse publiée sur le site de l'entreprise, avec la page source.
--   * Exclusivité conservée (invisible) : une entreprise n'est écrite que par
--     un stacker ; sans réponse, elle est mise en pause 90 jours pour tous.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Réglages
-- -----------------------------------------------------------------------------

alter table public.prospect_settings
  add column campaign_max_per_day integer not null default 200,
  add column campaign_no_reply_cooldown_days integer not null default 90,
  add column places_monthly_budget_usd integer not null default 50,
  add constraint prospect_settings_campaign_check check (
    campaign_max_per_day between 1 and 500 and campaign_no_reply_cooldown_days >= 0 and places_monthly_budget_usd >= 0
  );

insert into public.app_flags (key, enabled) values ('campaigns_enabled', true), ('leads_enrich_enabled', true);

alter table public.company_cooldowns drop constraint company_cooldowns_reason_check;
alter table public.company_cooldowns add constraint company_cooldowns_reason_check check (reason in ('pas_interesse', 'sans_reponse'));

-- -----------------------------------------------------------------------------
-- Contacts trouvés sur le site des entreprises (partagés entre stackers)
-- -----------------------------------------------------------------------------

create table public.company_contacts (
  siret       char(14) primary key references public.companies (siret) on delete cascade,
  email       text not null,
  email_kind  text not null default 'generique',
  phone       text,
  source_url  text not null,
  found_at    timestamptz not null default now(),
  checked_at  timestamptz not null default now(),
  constraint company_contacts_email_check check (
    email = lower(email) and char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'
  ),
  constraint company_contacts_kind_check check (email_kind in ('generique')),
  constraint company_contacts_phone_check check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint company_contacts_source_check check (source_url ~ '^https?://' and char_length(source_url) <= 500)
);

comment on table public.company_contacts is
  'Adresse générique publiée par l''entreprise sur son propre site (page source conservée). Jamais d''adresse devinée ni de contenu Google.';

-- Lieux Google déjà traités (seul identifiant Google conservable, §A.3 des conditions EEE).
create table public.places_seen (
  place_id   text primary key,
  siret      char(14),
  outcome    text not null,
  seen_at    timestamptz not null default now(),
  constraint places_seen_place_id_check check (char_length(place_id) between 10 and 300),
  constraint places_seen_outcome_check check (outcome in ('contact', 'no_site', 'no_email', 'no_match', 'error'))
);

-- Requêtes déjà jouées (commune × mot-clé), pour ne jamais payer deux fois.
create table public.enrich_queries (
  key        text primary key,
  department text not null,
  preset     text not null,
  done_at    timestamptz not null default now(),
  results    integer not null default 0,
  constraint enrich_queries_key_check check (char_length(key) between 5 and 200)
);
create index enrich_queries_dept_idx on public.enrich_queries (department, preset, done_at);

-- Budget global (coupe-circuit en dollars, en micro-dollars).
create table public.global_budgets (
  metric          text not null,
  period_start    date not null,
  spent_micro_usd bigint not null default 0,
  primary key (metric, period_start),
  constraint global_budgets_metric_check check (metric in ('places'))
);

-- -----------------------------------------------------------------------------
-- Boîtes mail connectées (envoi seulement)
-- -----------------------------------------------------------------------------

create table public.mail_accounts (
  stacker_id    uuid primary key references auth.users (id) on delete cascade,
  provider      text not null,
  email         text not null,
  -- Jeton de rafraîchissement CHIFFRÉ par l'Edge Function (AES-GCM, clé hors base).
  token_enc     text not null,
  status        text not null default 'active',
  last_error    text,
  connected_at  timestamptz not null default now(),
  first_send_on date,
  updated_at    timestamptz not null default now(),
  constraint mail_accounts_provider_check check (provider in ('gmail', 'outlook')),
  constraint mail_accounts_email_check check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$'),
  constraint mail_accounts_status_check check (status in ('active', 'error', 'revoked')),
  constraint mail_accounts_token_check check (char_length(token_enc) between 20 and 8000),
  constraint mail_accounts_error_check check (last_error is null or char_length(last_error) <= 200)
);

-- -----------------------------------------------------------------------------
-- Campagnes et file d'envoi
-- -----------------------------------------------------------------------------

create table public.campaigns (
  id           uuid primary key default gen_random_uuid(),
  stacker_id   uuid not null references auth.users (id) on delete cascade,
  department   text not null,
  preset       text not null references public.naf_presets (key),
  daily_target integer not null,
  template_key text not null references public.email_templates (key),
  status       text not null default 'active',
  filled_on    date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint campaigns_department_check check (department ~ '^(0[1-9]|1[0-9]|2[1-9]|[3-8][0-9]|9[0-5]|2A|2B|97[1-46])$'),
  constraint campaigns_target_check check (daily_target between 10 and 500),
  constraint campaigns_status_check check (status in ('active', 'paused', 'stopped'))
);
create unique index campaigns_one_open on public.campaigns (stacker_id) where status <> 'stopped';
create index campaigns_active_idx on public.campaigns (status) where status = 'active';

alter table public.prospect_claims add column campaign_id uuid references public.campaigns (id) on delete set null;
create index prospect_claims_campaign_idx on public.prospect_claims (campaign_id) where campaign_id is not null;

-- Les emails de campagne réutilisent prospect_emails (même pied, même jeton
-- d'opposition, même historique) avec un état d'envoi.
alter table public.prospect_emails
  add column campaign_id uuid references public.campaigns (id) on delete set null,
  add column send_status text,
  add column scheduled_for date,
  add column attempts integer not null default 0,
  add column locked_at timestamptz,
  add column provider_message_id text,
  add column send_error text;
alter table public.prospect_emails drop constraint prospect_emails_source_check;
alter table public.prospect_emails add constraint prospect_emails_source_check check (source in ('modele', 'ia', 'campagne'));
alter table public.prospect_emails add constraint prospect_emails_send_status_check check (
  (source <> 'campagne' and send_status is null)
  or (source = 'campagne' and send_status in ('queued', 'sending', 'sent', 'failed', 'cancelled'))
);
alter table public.prospect_emails add constraint prospect_emails_send_error_check check (send_error is null or char_length(send_error) <= 200);
create index prospect_emails_queue_idx on public.prospect_emails (stacker_id, scheduled_for) where send_status in ('queued', 'sending');
create index prospect_emails_sent_idx on public.prospect_emails (stacker_id, marked_sent_at) where marked_sent_at is not null;

-- -----------------------------------------------------------------------------
-- Droits et RLS
-- -----------------------------------------------------------------------------

revoke all on table public.company_contacts, public.places_seen, public.enrich_queries, public.global_budgets,
  public.mail_accounts, public.campaigns
  from public, anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['company_contacts', 'places_seen', 'enrich_queries', 'global_budgets', 'mail_accounts', 'campaigns'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I as permissive for all to postgres using (true) with check (true)', t || '_owner_all', t);
  end loop;
end $$;

-- Lecture : rien en direct (my_campaign() renvoie ce qui est utile, sans jeton).

-- -----------------------------------------------------------------------------
-- Fonctions internes
-- -----------------------------------------------------------------------------

-- Plafond du jour selon l'ancienneté de la boîte (montée progressive).
create function public.mail_warmup_cap(p_first_send_on date)
returns integer
language sql
stable
set search_path = ''
as $$
  select case
    when p_first_send_on is null then 20
    when public.paris_today() - p_first_send_on < 3 then 20
    when public.paris_today() - p_first_send_on < 7 then 40
    when public.paris_today() - p_first_send_on < 10 then 70
    when public.paris_today() - p_first_send_on < 14 then 100
    when public.paris_today() - p_first_send_on < 21 then 150
    else 500
  end
$$;

-- Fenêtre d'envoi : lundi-vendredi, 8 h 30 - 18 h 30 (Paris).
create function public.in_send_window(p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(isodow from p_at at time zone 'Europe/Paris') between 1 and 5
     and (p_at at time zone 'Europe/Paris')::time between time '08:30' and time '18:30'
$$;

-- Rendu d'un email (texte, signature, pied légal, jeton). Contrôles faits par l'appelant.
create function public.prospect_render_email(p_claim public.prospect_claims, p_template_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s         public.prospect_settings%rowtype;
  t         public.email_templates%rowtype;
  co        public.companies%rowtype;
  p         public.profiles%rowtype;
  v_name    text;
  v_city    text;
  v_token   text := encode(extensions.gen_random_bytes(24), 'hex');
  v_subject text;
  v_body    text;
begin
  select * into p from public.profiles x where x.id = p_claim.stacker_id;
  if p.first_name is null or p.last_name is null then
    raise exception 'profile_incomplete' using errcode = 'P0001';
  end if;
  select * into t from public.email_templates x where x.key = p_template_key and x.active;
  if not found then
    raise exception 'unknown_template' using errcode = '22023';
  end if;
  select * into s from public.prospect_settings;
  select * into co from public.companies x where x.siret = p_claim.siret;
  v_name := initcap(lower(co.name));
  v_city := coalesce(initcap(lower(co.city)), 'votre secteur');
  v_subject := left(replace(replace(replace(t.subject, '{{entreprise}}', v_name), '{{commune}}', v_city), '{{prenom}}', p.first_name), 140);
  v_body := replace(replace(replace(t.body, '{{entreprise}}', v_name), '{{commune}}', v_city), '{{prenom}}', p.first_name)
    || E'\n\nBien cordialement,\n' || p.first_name || ' ' || p.last_name
    || case when p.phone is not null then E'\n' || p.phone else '' end;
  return jsonb_build_object(
    'template', t.key,
    'subject', v_subject,
    'body', v_body,
    'token', v_token,
    'footer', p.first_name || ' ' || p.last_name || ', apporteur d''affaires indépendant pour Stacker — ' || s.sender_entity || E'.\n'
      || E'Je vous écris à l''adresse professionnelle publiée par votre entreprise ; les informations sur votre entreprise proviennent de la base SIRENE (INSEE).\n'
      || 'Pour ne plus être contacté par Stacker : ' || s.site_url || '/opposition?t=' || v_token || E'\n'
      || 'Vos droits : ' || s.site_url || '/confidentialite'
  );
end;
$$;

-- L'email manuel utilise le même rendu (une seule source de vérité).
create or replace function public.prospect_prepare_email(p_claim uuid, p_template_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.prospect_require_stacker();
  c     public.prospect_claims%rowtype;
  r     jsonb;
  v_id  uuid;
begin
  c := public.prospect_own_active(p_claim, v_uid);
  if c.contact_email is null then
    raise exception 'no_email' using errcode = 'P0001';
  end if;
  if public.is_opposed(left(c.siret, 9), c.contact_email, null) then
    raise exception 'opposed' using errcode = 'P0001';
  end if;
  r := public.prospect_render_email(c, p_template_key);
  perform public.usage_consume(v_uid, 'email_prepared', (select s.emails_prepared_per_day from public.prospect_settings s), null);
  insert into public.prospect_emails (claim_id, stacker_id, source, template_key, recipient, subject, body, footer, opposition_token)
  values (c.id, v_uid, 'modele', r ->> 'template', c.contact_email, r ->> 'subject', r ->> 'body', r ->> 'footer', r ->> 'token')
  returning id into v_id;
  perform public.prospect_log(c.id, v_uid, 'email_prepare', jsonb_build_object('template', r ->> 'template'));
  return jsonb_build_object('id', v_id, 'recipient', c.contact_email, 'subject', r ->> 'subject', 'body', r ->> 'body', 'footer', r ->> 'footer');
end;
$$;

-- Libération : une entreprise écrite sans réponse est mise en pause pour tous.
create or replace function public.prospect_release_internal(p_claim uuid, p_reason public.prospect_release_reason)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c public.prospect_claims%rowtype;
begin
  update public.prospect_claims x
  set released_at = now(), release_reason = p_reason, next_action_at = null
  where x.id = p_claim and x.released_at is null and x.status <> 'signe'
  returning * into c;
  if not found then
    return false;
  end if;
  -- Emails de campagne encore en file : annulés.
  update public.prospect_emails m set send_status = 'cancelled' where m.claim_id = c.id and m.send_status in ('queued', 'sending');
  if p_reason = 'expire' and c.status in ('contacte')
     and exists (select 1 from public.prospect_emails m where m.claim_id = c.id and m.marked_sent_at is not null) then
    insert into public.company_cooldowns (siren, until, reason)
    values (left(c.siret, 9), now() + make_interval(days => (select s.campaign_no_reply_cooldown_days from public.prospect_settings s)), 'sans_reponse')
    on conflict (siren) do update set until = greatest(public.company_cooldowns.until, excluded.until);
  end if;
  perform public.prospect_log(c.id, c.stacker_id,
    case p_reason when 'expire' then 'expire'::public.prospect_event_kind
                  when 'opposition' then 'opposition'::public.prospect_event_kind
                  else 'libere'::public.prospect_event_kind end,
    jsonb_build_object('reason', p_reason));
  return true;
end;
$$;

-- Les réservations de campagne ne comptent pas dans la limite des réservations manuelles.
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

-- Plafond d'envoi du jour pour un stacker : campagne, montée progressive, réglage global.
create function public.campaign_cap_today(p_campaign public.campaigns)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select least(
    p_campaign.daily_target,
    (select s.campaign_max_per_day from public.prospect_settings s),
    public.mail_warmup_cap((select a.first_send_on from public.mail_accounts a where a.stacker_id = p_campaign.stacker_id))
  )
$$;

-- Entreprises qu'une campagne peut encore écrire (vue interne, bornée).
create function public.campaign_candidates(p_campaign public.campaigns, p_limit integer)
returns table (siret char(14), email text)
language sql
stable
security definer
set search_path = ''
as $$
  select co.siret, cc.email
  from public.companies co
  join public.company_contacts cc on cc.siret = co.siret
  join public.naf_presets np on np.key = p_campaign.preset
  where co.department = p_campaign.department
    and co.naf = any (np.naf_codes)
    and not exists (select 1 from public.prospect_claims c where c.siret = co.siret and c.released_at is null)
    and not exists (select 1 from public.company_cooldowns k where k.siren = co.siren and k.until > now())
    and not exists (select 1 from public.prospect_claims c where c.siret = co.siret and c.stacker_id = p_campaign.stacker_id
                    and c.claimed_at > now() - interval '12 months')
    and (select count(*) from public.prospect_claims c where c.siret = co.siret and c.claimed_at > now() - interval '12 months')
        < (select s.max_claims_per_company_12m from public.prospect_settings s)
    and not public.is_opposed(co.siren, cc.email, cc.phone)
  -- Répartition équitable entre stackers d'une même zone.
  order by md5(co.siret || p_campaign.stacker_id::text)
  limit greatest(p_limit, 0)
$$;

-- -----------------------------------------------------------------------------
-- Fonctions du stacker connecté
-- -----------------------------------------------------------------------------

create function public.campaign_start(p_department text, p_preset text, p_daily_target integer, p_template_key text)
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

-- Pause, reprise, arrêt (arrêt : les emails en file sont annulés et les entreprises libérées).
create function public.campaign_set_status(p_status text)
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

-- Tout ce que l'écran « Campagne » affiche (jamais le jeton de la boîte).
create function public.my_campaign()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  k     public.campaigns%rowtype;
  a     public.mail_accounts%rowtype;
  v_today date := public.paris_today();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into a from public.mail_accounts x where x.stacker_id = v_uid;
  select * into k from public.campaigns x where x.stacker_id = v_uid and x.status <> 'stopped';
  return jsonb_build_object(
    'enabled', public.app_flag('campaigns_enabled'),
    'max_per_day', (select s.campaign_max_per_day from public.prospect_settings s),
    'mailbox', case when a.stacker_id is null then null else jsonb_build_object(
      'provider', a.provider, 'email', a.email, 'status', a.status, 'connected_at', a.connected_at,
      'warmup_cap', public.mail_warmup_cap(a.first_send_on)) end,
    'campaign', case when k.id is null then null else jsonb_build_object(
      'id', k.id, 'department', k.department, 'preset', k.preset, 'daily_target', k.daily_target,
      'template_key', k.template_key, 'status', k.status, 'created_at', k.created_at,
      'cap_today', public.campaign_cap_today(k),
      'sent_today', (select count(*) from public.prospect_emails m where m.campaign_id = k.id and m.send_status = 'sent'
                     and (m.marked_sent_at at time zone 'Europe/Paris')::date = v_today),
      'queued', (select count(*) from public.prospect_emails m where m.campaign_id = k.id and m.send_status in ('queued', 'sending')),
      'sent_total', (select count(*) from public.prospect_emails m where m.campaign_id = k.id and m.send_status = 'sent'),
      'failed_total', (select count(*) from public.prospect_emails m where m.campaign_id = k.id and m.send_status = 'failed'),
      'replied', (select count(*) from public.prospect_claims c where c.campaign_id = k.id and c.status in ('a_repondu', 'rdv', 'signe')),
      'available', (select count(*) from public.campaign_candidates(k, 1000))
    ) end
  );
end;
$$;

-- Déconnexion de la boîte : le jeton est effacé ; la campagne est mise en pause.
create function public.mail_disconnect()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.prospect_require_stacker();
begin
  delete from public.mail_accounts where stacker_id = v_uid;
  update public.campaigns set status = 'paused', updated_at = now() where stacker_id = v_uid and status = 'active';
end;
$$;

-- -----------------------------------------------------------------------------
-- Fonctions serveur (service_role : Edge Functions)
-- -----------------------------------------------------------------------------

create function public.mail_account_save(p_user uuid, p_provider text, p_email text, p_token_enc text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = p_user) then
    raise exception 'unknown_user' using errcode = 'P0002';
  end if;
  insert into public.mail_accounts (stacker_id, provider, email, token_enc, status, last_error, connected_at)
  values (p_user, p_provider, lower(btrim(p_email)), p_token_enc, 'active', null, now())
  on conflict (stacker_id) do update set
    provider = excluded.provider, email = excluded.email, token_enc = excluded.token_enc, status = 'active', last_error = null,
    connected_at = now(), updated_at = now(),
    -- Changer de boîte relance la montée progressive.
    first_send_on = case when public.mail_accounts.email = excluded.email then public.mail_accounts.first_send_on else null end;
end;
$$;

create function public.mail_account_error(p_user uuid, p_error text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.mail_accounts set status = 'error', last_error = left(p_error, 200), updated_at = now() where stacker_id = p_user
$$;

-- Remplit la file du jour de chaque campagne active (réservation en bloc + emails).
create function public.campaign_fill_due()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  k        public.campaigns%rowtype;
  v_today  date := public.paris_today();
  v_need   integer;
  v_total  integer := 0;
  x        record;
  c        public.prospect_claims%rowtype;
  r        jsonb;
begin
  if not public.app_flag('campaigns_enabled') or not public.app_flag('prospects_enabled') then
    return 0;
  end if;
  for k in
    select * from public.campaigns cp
    where cp.status = 'active'
      and exists (select 1 from public.mail_accounts a where a.stacker_id = cp.stacker_id and a.status = 'active')
    for update skip locked
  loop
    v_need := public.campaign_cap_today(k)
      - (select count(*) from public.prospect_emails m where m.campaign_id = k.id and (m.scheduled_for = v_today or m.send_status in ('queued', 'sending')));
    if v_need <= 0 then
      continue;
    end if;
    for x in select * from public.campaign_candidates(k, v_need) loop
      begin
        insert into public.prospect_claims (stacker_id, siret, expires_at, contact_email, contact_email_kind, contact_source, campaign_id)
        select k.stacker_id, x.siret, now() + interval '2 days', x.email, 'generique', cc.source_url, k.id
        from public.company_contacts cc where cc.siret = x.siret
        returning * into c;
      exception when unique_violation then
        continue; -- prise par un autre stacker entre-temps
      end;
      perform public.prospect_log(c.id, c.stacker_id, 'reserve', jsonb_build_object('campaign', true));
      r := public.prospect_render_email(c, k.template_key);
      insert into public.prospect_emails (claim_id, stacker_id, source, template_key, recipient, subject, body, footer, opposition_token,
                                          campaign_id, send_status, scheduled_for)
      values (c.id, c.stacker_id, 'campagne', r ->> 'template', x.email, r ->> 'subject', r ->> 'body', r ->> 'footer', r ->> 'token',
              k.id, 'queued', v_today);
      v_total := v_total + 1;
    end loop;
    update public.campaigns set filled_on = v_today, updated_at = now() where id = k.id;
  end loop;
  return v_total;
end;
$$;

-- Prochains emails à envoyer : au plus un par stacker et par passage, espacés
-- pour étaler le plafond du jour sur la fenêtre d'envoi. Verrouille (sending).
create function public.campaign_next_messages(p_limit integer, p_now timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  m     record;
begin
  if not public.in_send_window(p_now) or not public.app_flag('campaigns_enabled') then
    return v_out;
  end if;
  -- Envois bloqués depuis plus de 15 min (fonction interrompue) : remis en file.
  update public.prospect_emails set send_status = case when attempts >= 3 then 'failed' else 'queued' end
  where send_status = 'sending' and locked_at < now() - interval '15 minutes';
  for m in
    select distinct on (e.stacker_id) e.id, e.stacker_id, e.recipient, e.subject, e.body, e.footer,
           a.provider, a.email as from_email, a.token_enc, k.id as campaign_id
    from public.prospect_emails e
    join public.campaigns k on k.id = e.campaign_id and k.status = 'active'
    join public.mail_accounts a on a.stacker_id = e.stacker_id and a.status = 'active'
    join public.prospect_claims c on c.id = e.claim_id and c.released_at is null
    where e.send_status = 'queued' and e.scheduled_for <= public.paris_today()
      -- Un seul envoi en cours par stacker.
      and not exists (select 1 from public.prospect_emails s where s.stacker_id = e.stacker_id and s.send_status = 'sending')
      -- Espacement : 600 min de fenêtre / plafond du jour.
      and not exists (
        select 1 from public.prospect_emails s
        where s.stacker_id = e.stacker_id and s.send_status = 'sent'
          and s.marked_sent_at > now() - make_interval(secs => greatest(60, 36000 / greatest(public.campaign_cap_today(k), 1)))
      )
      and (select count(*) from public.prospect_emails s where s.stacker_id = e.stacker_id and s.send_status = 'sent'
           and (s.marked_sent_at at time zone 'Europe/Paris')::date = public.paris_today()) < public.campaign_cap_today(k)
    order by e.stacker_id, e.created_at
    limit greatest(least(p_limit, 500), 0)
  loop
    update public.prospect_emails set send_status = 'sending', attempts = attempts + 1, locked_at = now() where id = m.id and send_status = 'queued';
    if found then
      v_out := v_out || jsonb_build_object('id', m.id, 'stacker_id', m.stacker_id, 'provider', m.provider, 'from_email', m.from_email,
        'token_enc', m.token_enc, 'recipient', m.recipient, 'subject', m.subject, 'text', m.body || E'\n\n—\n' || m.footer);
    end if;
  end loop;
  return v_out;
end;
$$;

-- Résultat d'un envoi. p_auth_error : la boîte refuse (jeton révoqué) → pause.
create function public.campaign_message_result(p_id uuid, p_ok boolean, p_provider_id text, p_error text, p_auth_error boolean default false)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e public.prospect_emails%rowtype;
  c public.prospect_claims%rowtype;
begin
  select * into e from public.prospect_emails x where x.id = p_id and x.send_status = 'sending' for update;
  if not found then
    return;
  end if;
  if p_ok then
    update public.prospect_emails set send_status = 'sent', marked_sent_at = now(), provider_message_id = left(p_provider_id, 200), send_error = null where id = e.id;
    update public.mail_accounts set first_send_on = coalesce(first_send_on, public.paris_today()), updated_at = now() where stacker_id = e.stacker_id;
    select * into c from public.prospect_claims x where x.id = e.claim_id and x.released_at is null for update;
    if found then
      perform public.prospect_log(c.id, c.stacker_id, 'email_envoye', jsonb_build_object('email_id', e.id, 'campaign', true));
      if c.status = 'a_contacter' then
        perform public.prospect_apply_status(c, 'contacte', c.next_action_at);
      end if;
    end if;
    return;
  end if;
  if p_auth_error then
    update public.prospect_emails set send_status = 'queued', attempts = greatest(attempts - 1, 0), send_error = left(p_error, 200) where id = e.id;
    perform public.mail_account_error(e.stacker_id, p_error);
    return;
  end if;
  update public.prospect_emails
  set send_status = case when e.attempts >= 3 then 'failed' else 'queued' end, send_error = left(p_error, 200)
  where id = e.id;
  if e.attempts >= 3 then
    perform public.prospect_release_internal(e.claim_id, 'manuel');
  end if;
end;
$$;

-- Zones à enrichir : campagnes actives qui manquent d'entreprises écrivables.
create function public.enrich_targets(p_limit integer)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('department', t.department, 'preset', t.preset, 'missing', t.missing)), '[]'::jsonb)
  from (
    select k.department, k.preset, max(public.campaign_cap_today(k) * 3) - min((select count(*) from public.campaign_candidates(k, 2000))) as missing
    from public.campaigns k
    where k.status = 'active' and public.app_flag('leads_enrich_enabled')
    group by k.department, k.preset
    having max(public.campaign_cap_today(k) * 3) - min((select count(*) from public.campaign_candidates(k, 2000))) > 0
    order by 3 desc
    limit greatest(least(p_limit, 20), 0)
  ) t
$$;

-- Réserve une requête (commune × mot-clé) : true si elle n'a pas été jouée depuis 90 jours.
create function public.enrich_query_begin(p_key text, p_department text, p_preset text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.enrich_queries as q (key, department, preset) values (p_key, p_department, p_preset)
  on conflict (key) do update set done_at = now(), results = 0
    where q.done_at < now() - interval '90 days';
  return found;
end;
$$;

create function public.enrich_query_done(p_key text, p_results integer)
returns void
language sql
volatile
security definer
set search_path = ''
as $$ update public.enrich_queries set results = greatest(coalesce(p_results, 0), 0) where key = p_key $$;

-- Lieux pas encore traités parmi une liste de place_id.
create function public.enrich_unseen(p_place_ids text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p), '{}') from unnest(p_place_ids) p
  where not exists (select 1 from public.places_seen s where s.place_id = p and s.seen_at > now() - interval '12 months')
$$;

create function public.enrich_mark_seen(p_place_id text, p_siret text, p_outcome text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.places_seen (place_id, siret, outcome) values (p_place_id, p_siret, p_outcome)
  on conflict (place_id) do update set siret = excluded.siret, outcome = excluded.outcome, seen_at = now()
$$;

-- Enregistre une entreprise SIRENE et l'adresse générique trouvée sur SON site.
create function public.enrich_save_contact(p_company jsonb, p_email text, p_phone text, p_source_url text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_siret text := p_company ->> 'siret';
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_siret is null or v_siret !~ '^[0-9]{14}$' then
    raise exception 'invalid_siret' using errcode = '22023';
  end if;
  -- Même chemin que la recherche : upsert de l'entreprise (une ligne, pas de cache de page).
  insert into public.companies as co (
    siret, siren, name, naf, naf_label, employee_band, legal_category, is_sole_trader, created_on, is_head_office,
    address, postcode, city, department, latitude, longitude, officers, fetched_at
  )
  select x.siret, left(x.siret, 9), x.name, x.naf, x.naf_label, x.employee_band, x.legal_category, coalesce(x.is_sole_trader, false),
         x.created_on, x.is_head_office, x.address, x.postcode, x.city, x.department, x.latitude, x.longitude,
         coalesce(x.officers, '[]'::jsonb), now()
  from jsonb_to_record(p_company) as x(
    siret text, name text, naf text, naf_label text, employee_band text, legal_category text, is_sole_trader boolean,
    created_on date, is_head_office boolean, address text, postcode text, city text, department text,
    latitude numeric, longitude numeric, officers jsonb)
  on conflict (siret) do update set
    name = excluded.name, naf = excluded.naf, naf_label = excluded.naf_label, employee_band = excluded.employee_band,
    created_on = excluded.created_on, address = excluded.address, postcode = excluded.postcode, city = excluded.city,
    department = excluded.department, officers = excluded.officers, fetched_at = now();
  if public.is_opposed(left(v_siret, 9), v_email, p_phone) then
    return;
  end if;
  insert into public.company_contacts (siret, email, phone, source_url)
  values (v_siret, v_email, nullif(btrim(coalesce(p_phone, '')), ''), p_source_url)
  on conflict (siret) do update set email = excluded.email, phone = coalesce(excluded.phone, public.company_contacts.phone),
    source_url = excluded.source_url, checked_at = now();
end;
$$;

-- Coupe-circuit budgétaire global (mois en cours, Paris). true si la dépense est acceptée.
create function public.budget_consume(p_metric text, p_micro_usd bigint)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', public.paris_today())::date;
  v_cap   bigint := (select s.places_monthly_budget_usd::bigint * 1000000 from public.prospect_settings s);
  v_spent bigint;
begin
  insert into public.global_budgets as b (metric, period_start, spent_micro_usd) values (p_metric, v_month, 0)
  on conflict (metric, period_start) do nothing;
  update public.global_budgets b set spent_micro_usd = b.spent_micro_usd + p_micro_usd
  where b.metric = p_metric and b.period_start = v_month and b.spent_micro_usd + p_micro_usd <= v_cap
  returning b.spent_micro_usd into v_spent;
  return v_spent is not null;
end;
$$;

-- Les réservations de campagne qui n'ont jamais été envoyées expirent en 2 jours
-- (file annulée) ; celles envoyées suivent la règle « contacté » (21 jours).

-- -----------------------------------------------------------------------------
-- Export RGPD : la boîte connectée et les campagnes en font partie (sans jeton)
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
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tâches planifiées
-- -----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('campaigns-fill', '*/30 6-18 * * 1-5', 'select public.campaign_fill_due()');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Droits d'exécution
-- -----------------------------------------------------------------------------

revoke all on function
  public.mail_warmup_cap(date), public.in_send_window(timestamptz), public.prospect_render_email(public.prospect_claims, text),
  public.campaign_cap_today(public.campaigns), public.campaign_candidates(public.campaigns, integer),
  public.campaign_start(text, text, integer, text), public.campaign_set_status(text), public.my_campaign(), public.mail_disconnect(),
  public.mail_account_save(uuid, text, text, text), public.mail_account_error(uuid, text), public.campaign_fill_due(),
  public.campaign_next_messages(integer, timestamptz), public.campaign_message_result(uuid, boolean, text, text, boolean),
  public.enrich_targets(integer), public.enrich_query_begin(text, text, text), public.enrich_query_done(text, integer),
  public.enrich_unseen(text[]), public.enrich_mark_seen(text, text, text), public.enrich_save_contact(jsonb, text, text, text),
  public.budget_consume(text, bigint)
  from public, anon, authenticated, service_role;

-- prospect_prepare_email, prospect_release_internal et prospect_claim ont été remplacées : droits réappliqués.
revoke all on function public.prospect_prepare_email(uuid, text), public.prospect_release_internal(uuid, public.prospect_release_reason),
  public.prospect_claim(text), public.export_my_data()
  from public, anon, authenticated, service_role;
grant execute on function public.prospect_prepare_email(uuid, text), public.prospect_claim(text), public.export_my_data() to authenticated;

grant execute on function public.campaign_start(text, text, integer, text), public.campaign_set_status(text), public.my_campaign(),
  public.mail_disconnect()
  to authenticated;

grant execute on function public.mail_account_save(uuid, text, text, text), public.mail_account_error(uuid, text), public.campaign_fill_due(),
  public.campaign_next_messages(integer, timestamptz), public.campaign_message_result(uuid, boolean, text, text, boolean),
  public.enrich_targets(integer), public.enrich_query_begin(text, text, text), public.enrich_query_done(text, integer),
  public.enrich_unseen(text[]), public.enrich_mark_seen(text, text, text), public.enrich_save_contact(jsonb, text, text, text),
  public.budget_consume(text, bigint)
  to service_role;
