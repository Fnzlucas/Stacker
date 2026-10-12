-- =============================================================================
-- Stacker — Lot 8 : espace admin
--
-- Rôle admin tenu en base (table admins, remplie à la main en SQL : jamais
-- depuis l'app). Chaque fonction admin_* vérifie ce rôle et chaque action est
-- journalisée (admin_log) :
--   * vue d'ensemble : stackers, abonnements, deals, revenus clients,
--     virements à faire, incidents (Mollie, emails) ;
--   * virements : liste des demandes avec l'IBAN complet du stacker (pour
--     faire le virement), marquer versé ou refusé (le stacker est prévenu
--     par email) ;
--   * deals : recherche, suspendre / résilier / annuler ;
--   * offres : activer / désactiver ;
--   * stackers : recherche, abonnement, deals, solde ;
--   * interrupteurs : prospection, campagnes, moteur, abonnement obligatoire.
-- =============================================================================

create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.admin_log (
  id         bigint generated always as identity primary key,
  admin_id   uuid references auth.users (id) on delete set null,
  action     text not null,
  target     text,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

revoke all on table public.admins, public.admin_log from public, anon, authenticated, service_role;
revoke all on sequence public.admin_log_id_seq from public, anon, authenticated, service_role;
alter table public.admins enable row level security;
alter table public.admins force row level security;
alter table public.admin_log enable row level security;
alter table public.admin_log force row level security;
create policy admins_owner on public.admins for all to postgres using (true) with check (true);
create policy admin_log_owner on public.admin_log for all to postgres using (true) with check (true);

-- Emails au stacker quand son virement est traité.
alter table public.email_outbox drop constraint email_outbox_kind;
alter table public.email_outbox add constraint email_outbox_kind check (kind in ('contrat_client', 'contrat_stacker', 'prenotification', 'bienvenue', 'abonnement_refuse',
  'abonnement_coupe', 'prelevement_refuse', 'virement_verse', 'virement_refuse'));

create function public.emails_on_payout_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'demande' and new.status in ('verse', 'refuse') and new.stacker_id is not null then
    perform public.email_enqueue(case when new.status = 'verse' then 'virement_verse' else 'virement_refuse' end, 'virement:' || new.id,
      new.stacker_id, null, null, jsonb_build_object('amount_cents', new.amount_cents, 'iban_last4', new.iban_last4, 'reason', new.provider_ref));
  end if;
  return null;
end;
$$;
revoke all on function public.emails_on_payout_done() from public, anon, authenticated, service_role;
create trigger payouts_emails_done after update of status on public.payouts for each row execute function public.emails_on_payout_done();

-- -----------------------------------------------------------------------------
-- Contrôle d'accès
-- -----------------------------------------------------------------------------

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

create function public.admin_require()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (select 1 from public.admins a where a.user_id = v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function public.admin_audit(p_admin uuid, p_action text, p_target text, p_detail jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.admin_log (admin_id, action, target, detail) values (p_admin, p_action, left(p_target, 200), coalesce(p_detail, '{}'::jsonb));
$$;

-- -----------------------------------------------------------------------------
-- Lecture
-- -----------------------------------------------------------------------------

create function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.admin_require();
begin
  return jsonb_build_object(
    'stackers', (select count(*) from public.profiles p where p.onboarding_completed_at is not null),
    'signups_7d', (select count(*) from public.profiles p where p.created_at > now() - interval '7 days'),
    'subscriptions', (select count(*) from public.stacker_billing b where b.status in ('actif', 'impaye')),
    'subscriptions_unpaid', (select count(*) from public.stacker_billing b where b.status = 'impaye'),
    'launch_members', (select count(*) from public.stacker_billing b where b.launch_member),
    'launch_seats', (select s.launch_seats from public.billing_settings s where s.id),
    'deals', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb) from (select d.status::text as status, count(*) as n from public.deals d group by d.status) x),
    'deals_7d', (select count(*) from public.deals d where d.signed_at > now() - interval '7 days'),
    'client_monthly_cents', (select coalesce(sum(d.monthly_price_cents), 0) from public.deals d where d.status = 'actif'),
    'payouts_pending', (select count(*) from public.payouts p where p.status = 'demande'),
    'payouts_pending_cents', (select coalesce(sum(p.amount_cents), 0) from public.payouts p where p.status = 'demande'),
    'commissions_available_cents', (select coalesce(sum(e.amount_cents), 0) from public.commission_entries e where e.status = 'disponible' and e.available_at <= now()),
    'mollie_errors', (select count(*) from public.deals d where d.mollie_status = 'erreur' or (d.mollie_status = 'a_faire' and d.mollie_attempts >= 3)),
    'emails_failed', (select count(*) from public.email_outbox o where o.status = 'echoue'),
    'flags', (select jsonb_object_agg(f.key, f.enabled) from public.app_flags f),
    'log', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'target', l.target, 'detail', l.detail, 'created_at', l.created_at,
                                                        'admin', (select u.email from auth.users u where u.id = l.admin_id)) order by l.created_at desc)
                     from (select * from public.admin_log order by created_at desc limit 30) l), '[]'::jsonb)
  );
end;
$$;

-- Virements demandés : IBAN complet (déchiffré) pour faire le virement à la main.
create function public.admin_payouts(p_status text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.admin_require();
begin
  if p_status not in ('demande', 'verse', 'refuse') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'amount_cents', p.amount_cents, 'status', p.status, 'requested_at', p.requested_at, 'processed_at', p.processed_at,
      'reference', p.provider_ref, 'iban_last4', p.iban_last4,
      'stacker_id', p.stacker_id,
      'stacker_name', nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
      'stacker_email', (select u.email from auth.users u where u.id = p.stacker_id),
      'holder', a.holder,
      'iban', case when p.status = 'demande' and a.iban_last4 = p.iban_last4 then extensions.pgp_sym_decrypt(a.iban_enc, public.iban_key()) end
    ) order by p.requested_at)
    from (select * from public.payouts x where x.status = p_status::public.payout_status order by x.requested_at desc limit 200) p
    left join public.profiles pr on pr.id = p.stacker_id
    left join public.payout_accounts a on a.stacker_id = p.stacker_id), '[]'::jsonb);
end;
$$;

create function public.admin_deals(p_status text, p_search text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.admin_require();
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if p_status is not null and p_status not in ('signe', 'actif', 'suspendu', 'resilie', 'annule') then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'reference', d.reference, 'status', d.status, 'company_name', d.company_name, 'company_siret', d.company_siret,
      'contact_email', d.contact_email, 'contact_phone', d.contact_phone,
      'offer_label', (d.offer_snapshot ->> 'brand') || ' · ' || (d.offer_snapshot ->> 'name'),
      'monthly_price_cents', d.monthly_price_cents, 'signed_at', d.signed_at, 'activated_at', d.activated_at, 'ended_at', d.ended_at,
      'end_reason', d.end_reason, 'mollie_status', d.mollie_status, 'mollie_error', d.mollie_error, 'first_debit_on', d.first_debit_on,
      'payments', (select count(*) from public.deal_payments x where x.deal_id = d.id and x.reversed_at is null),
      'stacker_name', nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
    ) order by d.signed_at desc)
    from (select * from public.deals x
          where (p_status is null or x.status = p_status::public.deal_status)
            and (v_q is null or x.company_name ilike '%' || v_q || '%' or x.reference ilike '%' || v_q || '%' or x.company_siret = regexp_replace(v_q, '\s', '', 'g'))
          order by x.signed_at desc limit 200) d
    left join public.profiles p on p.id = d.stacker_id), '[]'::jsonb);
end;
$$;

create function public.admin_offers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.admin_require();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id, 'brand', o.brand, 'name', o.name, 'category', o.category, 'price_cents', o.price_cents,
                                        'unit_label', o.unit_label, 'engagement_months', o.engagement_months, 'active', o.active,
                                        'deals', (select count(*) from public.deals d where d.offer_id = o.id)) order by o.sort_order)
    from public.offers o), '[]'::jsonb);
end;
$$;

create function public.admin_stackers(p_search text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.admin_require();
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'email', p.email, 'phone', p.phone,
      'department', p.department, 'tier', p.tier, 'active_clients', p.active_clients,
      'onboarded', p.onboarding_completed_at is not null, 'created_at', p.created_at,
      'subscription', coalesce(b.status, 'aucun'), 'launch_member', coalesce(b.launch_member, false), 'period_end', b.current_period_end,
      'deals', (select count(*) from public.deals d where d.stacker_id = p.id),
      'available_cents', public.available_balance(p.id)
    ) order by p.created_at desc)
    from (select x.*, u.email from public.profiles x join auth.users u on u.id = x.id
          where v_q is null or u.email ilike '%' || v_q || '%' or concat_ws(' ', x.first_name, x.last_name) ilike '%' || v_q || '%'
          order by x.created_at desc limit 200) p
    left join public.stacker_billing b on b.stacker_id = p.id), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Actions
-- -----------------------------------------------------------------------------

create function public.admin_payout_mark(p_payout uuid, p_status text, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.admin_require();
begin
  if p_status not in ('verse', 'refuse') or (p_status = 'refuse' and char_length(btrim(coalesce(p_note, ''))) < 3) then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform public.payout_mark(p_payout, p_status::public.payout_status, nullif(btrim(coalesce(p_note, '')), ''));
  perform public.admin_audit(v_uid, 'payout_' || p_status, p_payout::text, jsonb_build_object('note', left(p_note, 200)));
end;
$$;

create function public.admin_deal_set_status(p_deal uuid, p_status text, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.admin_require();
begin
  if p_status not in ('suspendu', 'resilie', 'annule') or char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform public.deal_set_status(p_deal, p_status::public.deal_status, btrim(p_reason));
  perform public.admin_audit(v_uid, 'deal_' || p_status, p_deal::text, jsonb_build_object('reason', left(p_reason, 200)));
end;
$$;

create function public.admin_offer_set_active(p_offer text, p_active boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.admin_require();
begin
  if p_active is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  update public.offers set active = p_active, updated_at = now() where id = p_offer;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  perform public.admin_audit(v_uid, case when p_active then 'offer_on' else 'offer_off' end, p_offer, '{}'::jsonb);
end;
$$;

create function public.admin_set_flag(p_key text, p_enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.admin_require();
begin
  if p_key not in ('prospects_enabled', 'campaigns_enabled', 'leads_enrich_enabled', 'billing_required') or p_enabled is null then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  update public.app_flags set enabled = p_enabled, updated_at = now() where key = p_key;
  perform public.admin_audit(v_uid, 'flag', p_key, jsonb_build_object('enabled', p_enabled));
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilèges : les fonctions admin sont appelables par tout utilisateur
-- connecté, et refusent tout le monde sauf les admins (admin_require).
-- -----------------------------------------------------------------------------

revoke all on function public.is_admin(), public.admin_require(), public.admin_audit(uuid, text, text, jsonb), public.admin_overview(), public.admin_payouts(text),
  public.admin_deals(text, text), public.admin_offers(), public.admin_stackers(text), public.admin_payout_mark(uuid, text, text),
  public.admin_deal_set_status(uuid, text, text), public.admin_offer_set_active(text, boolean), public.admin_set_flag(text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.is_admin(), public.admin_overview(), public.admin_payouts(text), public.admin_deals(text, text), public.admin_offers(),
  public.admin_stackers(text), public.admin_payout_mark(uuid, text, text), public.admin_deal_set_status(uuid, text, text),
  public.admin_offer_set_active(text, boolean), public.admin_set_flag(text, boolean)
  to authenticated;
