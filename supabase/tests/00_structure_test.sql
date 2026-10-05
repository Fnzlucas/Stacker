-- Structure de sécurité : RLS forcée, aucun privilège client, fonctions durcies.
-- Ce test échoue si une table publique est ajoutée sans RLS forcée.
begin;
do $$ begin create extension if not exists pgtap with schema extensions; exception when others then null; end $$;

select plan(9);

select is(
  (select count(*)::int
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and not (c.relrowsecurity and c.relforcerowsecurity)),
  0,
  'toutes les tables du schéma public ont la RLS activée ET forcée'
);

select is(
  (select count(*)::int
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       or has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))),
  0,
  'anon et authenticated n''ont aucun privilège sur les tables et vues de public'
);

select is(
  (select count(*)::int
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S'
     and (has_sequence_privilege('anon', c.oid, 'USAGE, SELECT, UPDATE')
       or has_sequence_privilege('authenticated', c.oid, 'USAGE, SELECT, UPDATE'))),
  0,
  'anon et authenticated n''ont aucun privilège sur les séquences de public'
);

select is(
  (select count(*)::int
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and has_table_privilege('service_role', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')),
  0,
  'service_role n''a pas d''accès direct aux tables : uniquement via les fonctions'
);

select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg like 'search_path=%')),
  0,
  'toute fonction SECURITY DEFINER de public fixe son search_path'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  array['waitlist_count']::text[],
  'anon ne peut exécuter que waitlist_count()'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  array['waitlist_count']::text[],
  'authenticated ne peut exécuter que waitlist_count()'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('service_role', p.oid, 'EXECUTE')),
  array['rate_limit_hit', 'waitlist_count', 'waitlist_erase', 'waitlist_join']::text[],
  'service_role exécute exactement les 4 fonctions prévues (pas la fonction de trigger)'
);

select is(
  (select pg_get_function_result(p.oid)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'waitlist_count'),
  'integer',
  'waitlist_count() ne renvoie qu''un entier'
);

select * from finish();
rollback;
