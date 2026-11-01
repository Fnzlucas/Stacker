-- =============================================================================
-- Stacker — Notifications push (application iPhone)
--
--   * L'application enregistre l'appareil (push_register) après l'accord du
--     stacker dans la fenêtre système d'iOS. Un jeton appartient à un seul
--     compte : s'il change de compte sur le même téléphone, il suit.
--   * Événements notifiés (déclencheurs) :
--       - commission débloquée : le client a été prélevé ;
--       - virement envoyé ;
--       - boîte mail à reconnecter (campagne en pause).
--   * File push_outbox lue par l'Edge Function push-run (service_role) qui
--     envoie à Apple (APNs) ; les jetons refusés par Apple sont supprimés.
--   * Rien n'est mis en file pour un stacker sans appareil enregistré.
-- =============================================================================

create table public.push_devices (
  token        text primary key,
  stacker_id   uuid not null references public.profiles (id) on delete cascade,
  platform     text not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_devices_platform check (platform in ('ios', 'android')),
  constraint push_devices_token check (token ~ '^[A-Za-z0-9:_-]+$' and char_length(token) between 20 and 400)
);
create index push_devices_stacker_idx on public.push_devices (stacker_id);

create table public.push_outbox (
  id          bigint generated always as identity primary key,
  stacker_id  uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,
  dedupe      text not null unique,
  title       text not null,
  body        text not null,
  path        text not null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    integer not null default 0,
  locked_at   timestamptz,
  last_error  text,
  constraint push_outbox_kind check (kind in ('commission', 'virement', 'boite')),
  constraint push_outbox_path check (path ~ '^/app(/[a-z0-9/?=&_-]*)?$'),
  constraint push_outbox_text check (char_length(title) between 1 and 80 and char_length(body) between 1 and 240),
  constraint push_outbox_error check (last_error is null or char_length(last_error) <= 200)
);
create index push_outbox_due_idx on public.push_outbox (created_at) where sent_at is null;

revoke all on table public.push_devices, public.push_outbox from public, anon, authenticated, service_role;
revoke all on sequence public.push_outbox_id_seq from public, anon, authenticated, service_role;
alter table public.push_devices enable row level security;
alter table public.push_devices force row level security;
alter table public.push_outbox enable row level security;
alter table public.push_outbox force row level security;
create policy push_devices_owner_all on public.push_devices as permissive for all to postgres using (true) with check (true);
create policy push_outbox_owner_all on public.push_outbox as permissive for all to postgres using (true) with check (true);

-- -----------------------------------------------------------------------------
-- Appareil du stacker
-- -----------------------------------------------------------------------------

create function public.push_register(p_token text, p_platform text)
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
  if p_token is null or p_token !~ '^[A-Za-z0-9:_-]+$' or char_length(p_token) not between 20 and 400 or p_platform not in ('ios', 'android') then
    raise exception 'invalid_token' using errcode = '22023';
  end if;
  insert into public.push_devices (token, stacker_id, platform) values (p_token, v_uid, p_platform)
  on conflict (token) do update set stacker_id = excluded.stacker_id, platform = excluded.platform, last_seen_at = now();
end;
$$;

create function public.push_unregister(p_token text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.push_devices where token = p_token and stacker_id = (select auth.uid())
$$;

-- -----------------------------------------------------------------------------
-- Mise en file (interne)
-- -----------------------------------------------------------------------------

create function public.push_euros(p_cents integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(to_char(p_cents / 100.0, 'FM999999990.00'), '.', ',') || ' €'
$$;

create function public.push_enqueue(p_stacker uuid, p_kind text, p_dedupe text, p_title text, p_body text, p_path text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.push_outbox (stacker_id, kind, dedupe, title, body, path)
  select p_stacker, p_kind, p_dedupe, left(p_title, 80), left(p_body, 240), p_path
  where p_stacker is not null and exists (select 1 from public.push_devices d where d.stacker_id = p_stacker)
  on conflict (dedupe) do nothing
$$;

create function public.push_on_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text;
begin
  if new.kind = 'commission' and new.amount_cents > 0 and new.stacker_id is not null then
    select d.company_name into v_company from public.deals d where d.id = new.deal_id;
    perform public.push_enqueue(new.stacker_id, 'commission', 'commission:' || new.id,
      'Commission débloquée',
      coalesce(v_company, 'Ton client') || ' a été prélevé : ' || public.push_euros(new.amount_cents) || ' disponibles dans Gains.',
      '/app/gains');
  end if;
  return null;
end;
$$;
create trigger commission_entries_push after insert on public.commission_entries for each row execute function public.push_on_commission();

create function public.push_on_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'verse' and old.status is distinct from 'verse' then
    perform public.push_enqueue(new.stacker_id, 'virement', 'virement:' || new.id,
      'Virement envoyé',
      public.push_euros(new.amount_cents) || ' sont en route vers ton compte ••' || new.iban_last4 || '.',
      '/app/gains');
  end if;
  return null;
end;
$$;
create trigger payouts_push after update of status on public.payouts for each row execute function public.push_on_payout();

create function public.push_on_mailbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'error' and old.status is distinct from 'error' then
    perform public.push_enqueue(new.stacker_id, 'boite', 'boite:' || new.stacker_id || ':' || extract(epoch from now())::bigint,
      'Campagne en pause',
      'Ta boîte mail doit être reconnectée pour reprendre tes envois.',
      '/app/prospects');
  end if;
  return null;
end;
$$;
create trigger mail_accounts_push after update of status on public.mail_accounts for each row execute function public.push_on_mailbox();

-- -----------------------------------------------------------------------------
-- Envoi (Edge Function push-run, service_role)
-- -----------------------------------------------------------------------------

-- Prochaines notifications, avec les jetons du stacker. Verrouille 5 minutes.
create function public.push_next(p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  o record;
begin
  -- Trop anciennes ou trop d'essais : abandonnées (une notification n'a de sens que tout de suite).
  update public.push_outbox set sent_at = now(), last_error = coalesce(last_error, 'expired')
  where sent_at is null and (created_at < now() - interval '2 days' or attempts >= 5);
  for o in
    select x.* from public.push_outbox x
    where x.sent_at is null and (x.locked_at is null or x.locked_at < now() - interval '5 minutes')
    order by x.created_at
    limit greatest(least(p_limit, 500), 0)
    for update skip locked
  loop
    update public.push_outbox set locked_at = now(), attempts = attempts + 1 where id = o.id;
    v_out := v_out || jsonb_build_object('id', o.id, 'title', o.title, 'body', o.body, 'path', o.path,
      'tokens', coalesce((select jsonb_agg(jsonb_build_object('token', d.token, 'platform', d.platform))
                          from public.push_devices d where d.stacker_id = o.stacker_id), '[]'::jsonb));
  end loop;
  return v_out;
end;
$$;

create function public.push_result(p_id bigint, p_ok boolean, p_error text, p_bad_tokens text[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_bad_tokens is not null and cardinality(p_bad_tokens) > 0 then
    delete from public.push_devices where token = any (p_bad_tokens);
  end if;
  update public.push_outbox
  set sent_at = case when p_ok then now() else sent_at end, locked_at = null, last_error = left(p_error, 200)
  where id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------

revoke all on function public.push_register(text, text), public.push_unregister(text), public.push_euros(integer),
  public.push_enqueue(uuid, text, text, text, text, text), public.push_on_commission(), public.push_on_payout(), public.push_on_mailbox(),
  public.push_next(integer), public.push_result(bigint, boolean, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.push_register(text, text), public.push_unregister(text) to authenticated;
grant execute on function public.push_next(integer), public.push_result(bigint, boolean, text, text[]) to service_role;
