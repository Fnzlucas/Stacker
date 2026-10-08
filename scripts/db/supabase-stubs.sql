-- Stubs minimaux de l'environnement Supabase pour tester les migrations sur
-- un Postgres local jetable (scripts/test-db.sh). Exécuté en superutilisateur
-- (supabase_admin) AVANT les migrations, qui tournent ensuite sous le rôle
-- « postgres » comme sur Supabase.
--
-- Fidélité recherchée sur les points qui comptent pour la sécurité :
--   * rôles anon / authenticated / service_role (NOLOGIN) et authenticator ;
--   * service_role a BYPASSRLS (comme sur Supabase) ;
--   * « postgres » n'est PAS superutilisateur et n'a PAS BYPASSRLS ici : c'est
--     le cas le plus strict, il prouve que les politiques « to postgres »
--     suffisent aux fonctions SECURITY DEFINER sous RLS forcée ;
--   * privilèges par défaut identiques à Supabase : ALL sur les nouvelles
--     tables, séquences et fonctions du schéma public pour anon, authenticated
--     et service_role. Les « revoke » des migrations sont donc réellement testés.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;

create role postgres login nosuperuser createrole createdb nobypassrls;
grant anon, authenticated, service_role to postgres;
-- Les politiques « to postgres » visent ce rôle.

create database stacker_test owner postgres;
\connect stacker_test

-- Schéma public : propriété de la base (donc de postgres) comme sur Supabase.
alter schema public owner to postgres;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
-- Comme sur Supabase : pgcrypto est déjà installée dans le schéma extensions.
create extension if not exists pgcrypto with schema extensions;

-- Schéma auth minimal (helpers lus depuis les claims JWT de la requête).
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create function auth.jwt() returns jsonb
language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create function auth.uid() returns uuid
language sql stable
as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;

create function auth.role() returns text
language sql stable
as $$ select coalesce(auth.jwt() ->> 'role', 'anon') $$;

-- Colonnes utiles de auth.users (mêmes noms et types que GoTrue).
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
-- Sur Supabase, « postgres » lit auth.users, y pose des triggers et des clés
-- étrangères (profil créé à l'inscription, cascade à la suppression).
grant select, references, trigger on auth.users to postgres;

-- Privilèges par défaut de Supabase pour les objets créés par postgres.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
