-- =============================================================================
-- Stacker — SIRET obligatoire au-delà de 1 000 € versés dans l'année
--
--   Inscription, prospection et signature restent possibles sans SIRET.
--   Les virements sont libres tant que le total versé (ou demandé) dans
--   l'année civile reste sous le seuil ; au-delà, payout_request refuse
--   (siret_required) jusqu'à l'ajout d'un SIRET valide dans le profil.
--   Les commissions restent sur le solde : rien n'est perdu. Alerte dans
--   l'app à partir de 700 €. Seuils réglables (deal_settings).
-- =============================================================================

alter table public.deal_settings
  add column siret_threshold_cents integer not null default 100000,
  add column siret_warning_cents   integer not null default 70000,
  add constraint deal_settings_siret_check check (siret_threshold_cents between 0 and 10000000 and siret_warning_cents between 0 and siret_threshold_cents);

-- Total versé ou en cours de virement dans l'année civile (heure de Paris).
create function public.payout_year_total(p_stacker uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(p.amount_cents), 0)::integer from public.payouts p
  where p.stacker_id = p_stacker and p.status in ('demande', 'verse')
    and extract(year from p.requested_at at time zone 'Europe/Paris') = extract(year from now() at time zone 'Europe/Paris')
$$;
revoke all on function public.payout_year_total(uuid) from public, anon, authenticated, service_role;

create or replace function public.payout_request()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.deal_require_stacker();
  a public.payout_accounts%rowtype;
  v_amount integer;
  v_id uuid;
begin
  select * into a from public.payout_accounts x where x.stacker_id = v_uid;
  if not found then
    raise exception 'payout_account_required' using errcode = '55000';
  end if;
  if exists (select 1 from public.payouts p where p.stacker_id = v_uid and p.status = 'demande') then
    raise exception 'payout_pending' using errcode = '55000';
  end if;
  perform 1 from public.commission_entries e where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at <= now() for update;
  select coalesce(sum(e.amount_cents), 0) into v_amount from public.commission_entries e
  where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at <= now();
  if v_amount < (select s.min_payout_cents from public.deal_settings s where s.id) or v_amount <= 0 then
    raise exception 'payout_too_small' using errcode = '22023';
  end if;
  -- Au-delà du seuil annuel (1 000 € par défaut), SIRET obligatoire.
  if (select p.siret from public.profiles p where p.id = v_uid) is null
     and public.payout_year_total(v_uid) + v_amount > (select s.siret_threshold_cents from public.deal_settings s where s.id) then
    raise exception 'siret_required' using errcode = '55000';
  end if;
  insert into public.payouts (stacker_id, amount_cents, iban_last4) values (v_uid, v_amount, a.iban_last4) returning id into v_id;
  update public.commission_entries e set status = 'demandee', payout_id = v_id
  where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at <= now();
  return v_id;
end;
$$;

create or replace function public.my_earnings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.deal_require_stacker();
  v_rate integer := public.deal_rate_bps(v_uid);
begin
  return jsonb_build_object(
    'rate_bps', v_rate,
    'available_cents', coalesce((select sum(e.amount_cents) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at <= now()), 0),
    'validating_cents', coalesce((select sum(e.amount_cents) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at > now()), 0),
    'next_available_at', (select min(e.available_at) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at > now()),
    'requested_cents', coalesce((select sum(e.amount_cents) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'demandee'), 0),
    'paid_cents', coalesce((select sum(e.amount_cents) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'versee'), 0),
    'monthly_cents', coalesce((select sum(d.monthly_price_cents) from public.deals d where d.stacker_id = v_uid and d.status = 'actif'), 0) * v_rate / 10000,
    'pending_monthly_cents', coalesce((select sum(d.monthly_price_cents) from public.deals d where d.stacker_id = v_uid and d.status = 'signe'), 0) * v_rate / 10000,
    -- En attente : contrats signés, débloqués dès le premier prélèvement du client.
    'pending_cents', coalesce((select sum(d.monthly_price_cents * v_rate / 10000) from public.deals d where d.stacker_id = v_uid and d.status = 'signe'), 0),
    'pending_deals', coalesce((
      select jsonb_agg(jsonb_build_object('deal_id', d.id, 'company_name', d.company_name, 'expected_cents', d.monthly_price_cents * v_rate / 10000,
                                          'first_debit_on', (d.withdrawal_until at time zone 'Europe/Paris')::date + 1, 'signed_at', d.signed_at)
                       order by d.signed_at desc)
      from public.deals d where d.stacker_id = v_uid and d.status = 'signe'), '[]'::jsonb),
    'signed_count', (select count(*) from public.deals d where d.stacker_id = v_uid and d.status in ('signe', 'actif', 'suspendu')),
    'active_count', (select count(*) from public.deals d where d.stacker_id = v_uid and d.status = 'actif'),
    'year_paid_cents', public.payout_year_total(v_uid),
    'siret_threshold_cents', (select s.siret_threshold_cents from public.deal_settings s where s.id),
    'siret_warning_cents', (select s.siret_warning_cents from public.deal_settings s where s.id),
    'has_siret', (select p.siret is not null from public.profiles p where p.id = v_uid),
    'min_payout_cents', (select s.min_payout_cents from public.deal_settings s where s.id),
    'payout_account', (select jsonb_build_object('holder', a.holder, 'iban_last4', a.iban_last4) from public.payout_accounts a where a.stacker_id = v_uid),
    'entries', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select jsonb_build_object('id', e.id, 'period', e.period, 'amount_cents', e.amount_cents, 'rate_bps', e.rate_bps,
                                  'client_amount_cents', e.client_amount_cents, 'status', e.status, 'created_at', e.created_at,
                                  'available_at', e.available_at, 'kind', e.kind,
                                  'company_name', d.company_name, 'deal_id', d.id) j, e.created_at
        from public.commission_entries e left join public.deals d on d.id = e.deal_id
        where e.stacker_id = v_uid order by e.created_at desc limit 100) x), '[]'::jsonb),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'amount_cents', p.amount_cents, 'status', p.status, 'iban_last4', p.iban_last4,
                                          'requested_at', p.requested_at, 'processed_at', p.processed_at) order by p.requested_at desc)
      from public.payouts p where p.stacker_id = v_uid), '[]'::jsonb)
  );
end;
$$;
