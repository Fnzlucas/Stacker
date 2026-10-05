-- rate_limit_hit() : fenêtre fixe, seuil, isolation des clés, purge.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(8);

set local role service_role;
select is(public.rate_limit_hit('k1', 3, 600), true, '1re requête autorisée');
select is(public.rate_limit_hit('k1', 3, 600), true, '2e requête autorisée');
select is(public.rate_limit_hit('k1', 3, 600), true, '3e requête autorisée (seuil atteint)');
select is(public.rate_limit_hit('k1', 3, 600), false, '4e requête refusée');
select is(public.rate_limit_hit('k2', 3, 600), true, 'une autre clé a son propre compteur');
select throws_ok($$select public.rate_limit_hit('k1', 0, 600)$$, '22023', 'invalid_rate_limit_arguments', 'seuil nul refusé');
select throws_ok($$select public.rate_limit_hit('k1', 3, 90000)$$, '22023', 'invalid_rate_limit_arguments', 'fenêtre > 24 h refusée');
reset role;

insert into public.rate_limits (bucket, window_start, hits) values ('ancien', now() - interval '2 days', 50);
set local role service_role;
select public.rate_limit_hit('k3', 3, 600);
reset role;
select is((select count(*)::int from public.rate_limits where bucket = 'ancien'), 0, 'les fenêtres de plus de 24 h sont purgées');

select * from finish();
rollback;
