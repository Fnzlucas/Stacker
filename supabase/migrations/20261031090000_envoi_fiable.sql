-- =============================================================================
-- Stacker — Envoi des campagnes : fiabilité et délivrabilité
--
--   * Limite d'envoi du fournisseur (Gmail « userRateLimitExceeded »,
--     « dailyLimitExceeded », Outlook « ErrorExceededMessageLimit », HTTP 429) :
--     la boîte n'est PLUS marquée « à reconnecter » et l'email n'est PLUS
--     compté comme un échec. Il est remis en file sans consommer d'essai, et la
--     boîte est mise en pause le temps indiqué (throttled_until).
--   * Volumes prudents pour des boîtes personnelles : montée 10 → 20 → 30 → 40
--     sur 3 semaines, puis le plafond global (50 par défaut, réglable par
--     l'admin dans prospect_settings).
--   * Équité : quand beaucoup de stackers attendent, on sert d'abord ceux dont
--     l'email attend depuis le plus longtemps (avant : toujours les mêmes
--     identifiants en premier).
--   * Nom d'affichage dans l'en-tête From (« Inès Martin <ines@…> ») : plus
--     de confiance, meilleure délivrabilité.
-- =============================================================================

alter table public.mail_accounts add column throttled_until timestamptz;

-- Reconnexion de la boîte (nouveau jeton) : la pause est levée.
create function public.mail_accounts_reset_throttle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.token_enc is distinct from old.token_enc then
    new.throttled_until := null;
  end if;
  return new;
end;
$$;
revoke all on function public.mail_accounts_reset_throttle() from public, anon, authenticated, service_role;

create trigger mail_accounts_reset_throttle
before update on public.mail_accounts
for each row execute function public.mail_accounts_reset_throttle();

-- Plafond global prudent (boîtes Gmail / Outlook personnelles).
alter table public.prospect_settings alter column campaign_max_per_day set default 50;
update public.prospect_settings set campaign_max_per_day = 50 where campaign_max_per_day > 50;

-- Montée progressive : 10, 20, 30, 40 puis le plafond global.
create or replace function public.mail_warmup_cap(p_first_send_on date)
returns integer
language sql
stable
set search_path = ''
as $$
  select case
    when p_first_send_on is null then 10
    when public.paris_today() - p_first_send_on < 3 then 10
    when public.paris_today() - p_first_send_on < 7 then 20
    when public.paris_today() - p_first_send_on < 14 then 30
    when public.paris_today() - p_first_send_on < 21 then 40
    else 500
  end
$$;

-- Prochains emails : boîtes en pause exclues, nom d'affichage, ordre équitable.
create or replace function public.campaign_next_messages(p_limit integer, p_now timestamptz default now())
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
    select * from (
      select distinct on (e.stacker_id) e.id, e.stacker_id, e.recipient, e.subject, e.body, e.footer, e.created_at,
             a.provider, a.email as from_email, a.token_enc, k.id as campaign_id,
             nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as from_name
      from public.prospect_emails e
      join public.campaigns k on k.id = e.campaign_id and k.status = 'active'
      join public.mail_accounts a on a.stacker_id = e.stacker_id and a.status = 'active'
        and (a.throttled_until is null or a.throttled_until <= now())
      join public.prospect_claims c on c.id = e.claim_id and c.released_at is null
      left join public.profiles p on p.id = e.stacker_id
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
    ) q
    order by q.created_at
    limit greatest(least(p_limit, 500), 0)
  loop
    update public.prospect_emails set send_status = 'sending', attempts = attempts + 1, locked_at = now() where id = m.id and send_status = 'queued';
    if found then
      v_out := v_out || jsonb_build_object('id', m.id, 'stacker_id', m.stacker_id, 'provider', m.provider, 'from_email', m.from_email,
        'from_name', m.from_name, 'token_enc', m.token_enc, 'recipient', m.recipient, 'subject', m.subject,
        'text', m.body || E'\n\n—\n' || m.footer);
    end if;
  end loop;
  return v_out;
end;
$$;

-- Résultat d'un envoi.
--   p_auth_error         : la boîte refuse (jeton révoqué) → boîte à reconnecter ;
--   p_retry_after_seconds : limite du fournisseur → remis en file sans
--                           consommer d'essai, boîte en pause ce temps-là.
drop function public.campaign_message_result(uuid, boolean, text, text, boolean);
create function public.campaign_message_result(p_id uuid, p_ok boolean, p_provider_id text, p_error text, p_auth_error boolean default false,
                                               p_retry_after_seconds integer default null)
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
  if p_retry_after_seconds is not null then
    update public.prospect_emails set send_status = 'queued', attempts = greatest(attempts - 1, 0), send_error = left(p_error, 200) where id = e.id;
    update public.mail_accounts
    set throttled_until = now() + make_interval(secs => least(greatest(p_retry_after_seconds, 60), 86400)), updated_at = now()
    where stacker_id = e.stacker_id;
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

revoke all on function public.campaign_message_result(uuid, boolean, text, text, boolean, integer) from public, anon, authenticated, service_role;
grant execute on function public.campaign_message_result(uuid, boolean, text, text, boolean, integer) to service_role;

-- -----------------------------------------------------------------------------
-- Moteur de prospection : ne rien perdre sur une erreur passagère
-- -----------------------------------------------------------------------------

-- Requête Google non aboutie (budget, quota, erreur réseau) : rendue jouable
-- tout de suite, au lieu d'être écartée 90 jours.
create function public.enrich_query_cancel(p_key text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.enrich_queries where key = p_key
$$;
revoke all on function public.enrich_query_cancel(text) from public, anon, authenticated, service_role;
grant execute on function public.enrich_query_cancel(text) to service_role;

-- Lieu en erreur passagère (site injoignable, source occupée) : retenté le
-- lendemain, au lieu d'être ignoré 12 mois.
create or replace function public.enrich_unseen(p_place_ids text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p), '{}') from unnest(p_place_ids) p
  where not exists (
    select 1 from public.places_seen s
    where s.place_id = p and s.seen_at > now() - interval '12 months'
      and not (s.outcome = 'error' and s.seen_at < now() - interval '1 day')
  )
$$;
