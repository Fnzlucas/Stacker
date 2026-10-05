-- Sous-ensemble compatible pgTAP (plan, ok, is, isnt, throws_ok, lives_ok,
-- finish) pour exécuter supabase/tests/*.sql sans l'extension pgTAP, qui
-- n'est pas installable dans l'environnement de build. Les mêmes fichiers
-- tournent tels quels avec la vraie extension (`supabase test db`).
--
-- throws_ok / lives_ok sont SECURITY INVOKER : le SQL testé s'exécute avec le
-- rôle courant (anon, authenticated…), jamais avec les droits du shim.

create schema tap;
grant usage on schema tap to public;

create unlogged table tap.state (
  id      integer primary key default 1 check (id = 1),
  planned integer not null default 0,
  run     integer not null default 0,
  failed  integer not null default 0
);

create function tap.plan(p_count integer) returns text
language plpgsql security definer set search_path = '' as $$
begin
  delete from tap.state;
  insert into tap.state (planned) values (p_count);
  return '1..' || p_count;
end $$;

create function tap.ok(p_ok boolean, p_description text default '') returns text
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update tap.state set run = run + 1, failed = failed + case when p_ok is true then 0 else 1 end
  returning run into v_n;
  return case when p_ok is true then 'ok ' else 'not ok ' end || v_n || ' - ' || coalesce(p_description, '');
end $$;

create function tap.is(p_have anyelement, p_want anyelement, p_description text default '') returns text
language plpgsql set search_path = '' as $$
declare v_ok boolean := p_have is not distinct from p_want;
begin
  return tap.ok(v_ok, p_description)
    || case when v_ok then '' else E'\n#   have: ' || coalesce(p_have::text, 'NULL') || E'\n#   want: ' || coalesce(p_want::text, 'NULL') end;
end $$;

create function tap.isnt(p_have anyelement, p_want anyelement, p_description text default '') returns text
language plpgsql set search_path = '' as $$
begin
  return tap.ok(p_have is distinct from p_want, p_description);
end $$;

create function tap.throws_ok(p_sql text, p_errcode char(5), p_errmsg text, p_description text) returns text
language plpgsql security invoker as $$
begin
  execute p_sql;
  return tap.ok(false, p_description) || E'\n#   aucune exception levée (attendu : ' || p_errcode || ')';
exception when others then
  if sqlstate = p_errcode and (p_errmsg is null or sqlerrm = p_errmsg) then
    return tap.ok(true, p_description);
  end if;
  return tap.ok(false, p_description)
    || E'\n#   reçu : ' || sqlstate || ' ' || sqlerrm
    || E'\n#   attendu : ' || p_errcode || coalesce(' ' || p_errmsg, '');
end $$;

create function tap.lives_ok(p_sql text, p_description text) returns text
language plpgsql security invoker as $$
begin
  execute p_sql;
  return tap.ok(true, p_description);
exception when others then
  return tap.ok(false, p_description) || E'\n#   exception : ' || sqlstate || ' ' || sqlerrm;
end $$;

create function tap.finish() returns setof text
language plpgsql security definer set search_path = '' as $$
declare v tap.state%rowtype;
begin
  select * into v from tap.state;
  if v.run <> v.planned then
    return next '# Looks like you planned ' || v.planned || ' tests but ran ' || v.run;
  end if;
  if v.failed > 0 then
    return next '# Looks like you failed ' || v.failed || ' test(s) of ' || v.run;
  end if;
end $$;

grant execute on all functions in schema tap to public;
