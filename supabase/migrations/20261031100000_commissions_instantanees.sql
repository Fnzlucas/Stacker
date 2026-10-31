-- =============================================================================
-- Stacker — Commissions débloquées dès le prélèvement du client
--
--   * Dès la signature : la commission du premier mois apparaît « en attente »
--     (my_earnings.pending_cents et pending_deals, avec la date prévue du
--     premier prélèvement).
--   * Dès que le paiement du client est confirmé (webhook Mollie) : la
--     commission est disponible immédiatement (plus de délai de 14 / 30 jours)
--     et le stacker peut demander son virement le jour même.
--   * Protection conservée : un prélèvement remboursé ou contesté (8 semaines
--     en SEPA) crée une reprise déduite du solde (deal_payment_reversed).
-- =============================================================================

alter table public.deal_settings alter column availability_days set default 0;
alter table public.deal_settings alter column availability_days_new_client set default 0;
update public.deal_settings set availability_days = 0, availability_days_new_client = 0;

-- Commissions déjà encaissées encore « en validation » : disponibles tout de suite.
update public.commission_entries set available_at = now()
where status = 'disponible' and kind = 'commission' and available_at > now();

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
