#!/usr/bin/env bash
# Tests base de données : lance un Postgres local jetable, recrée les rôles et
# privilèges par défaut de Supabase, applique les migrations sous le rôle
# « postgres » puis exécute supabase/tests/*.sql (syntaxe pgTAP).
#
# Variables : PG_BIN (dossier des binaires Postgres, détecté sinon).
# Aucun port TCP n'est ouvert : socket Unix dans un dossier temporaire.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="${PG_BIN:-}"
if [[ -z "$PG_BIN" ]]; then
  for candidate in /usr/lib/postgresql/17/bin /usr/lib/postgresql/16/bin "$(dirname "$(command -v initdb 2>/dev/null || echo /nonexistent/x)")"; do
    if [[ -x "$candidate/initdb" ]]; then PG_BIN="$candidate"; break; fi
  done
fi
[[ -x "$PG_BIN/initdb" ]] || { echo "initdb introuvable : définis PG_BIN" >&2; exit 2; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/stacker-pg.XXXXXX")"
PORT=54329
PGDATA="$WORK/data"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# initdb refuse de tourner en root : on délègue à un utilisateur non privilégié si besoin.
RUN=()
if [[ "$(id -u)" == "0" ]]; then
  id -u postgres >/dev/null 2>&1 || useradd --system --no-create-home postgres
  chown -R postgres "$WORK"
  RUN=(runuser -u postgres --)
fi

"${RUN[@]}" "$PG_BIN/initdb" -D "$PGDATA" -U supabase_admin --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$PGDATA" -w -l "$WORK/pg.log" \
  -o "-c listen_addresses='' -k $WORK -p $PORT -c fsync=off -c synchronous_commit=off" start >/dev/null

PSQL=("$PG_BIN/psql" -h "$WORK" -p "$PORT" -X -q -v ON_ERROR_STOP=1 --no-psqlrc)

echo "→ stubs Supabase (rôles, schémas auth/extensions, privilèges par défaut)"
"${PSQL[@]}" -U supabase_admin -d postgres -f "$ROOT/scripts/db/supabase-stubs.sql" >/dev/null

echo "→ migrations (rôle postgres, non superutilisateur, sans BYPASSRLS)"
shopt -s nullglob
for migration in "$ROOT"/supabase/migrations/*.sql; do
  echo "   $(basename "$migration")"
  "${PSQL[@]}" -U postgres -d stacker_test -1 -f "$migration" >/dev/null
done
"${PSQL[@]}" -U postgres -d stacker_test -1 -f "$ROOT/supabase/seed.sql" >/dev/null

echo "→ shim pgTAP"
"${PSQL[@]}" -U supabase_admin -d stacker_test -f "$ROOT/scripts/db/tap-shim.sql" >/dev/null

total=0
failed=0
for test in "$ROOT"/supabase/tests/*.sql; do
  name="$(basename "$test")"
  # Exécuté par un rôle membre de anon/authenticated/service_role, comme `supabase test db`.
  if ! output="$("${PSQL[@]}" -U supabase_admin -d stacker_test -t -A -c 'set search_path = public, extensions, tap' -f "$test" 2>&1)"; then
    echo "✗ $name : erreur d'exécution" >&2
    echo "$output" >&2
    failed=$((failed + 1))
    continue
  fi
  planned="$(grep -E '^1\.\.[0-9]+$' <<<"$output" | head -1 | cut -d. -f3)"
  passed="$(grep -cE '^ok [0-9]+' <<<"$output" || true)"
  notok="$(grep -cE '^not ok [0-9]+' <<<"$output" || true)"
  total=$((total + passed + notok))
  if [[ "$notok" != "0" || -z "$planned" || "$passed" != "$planned" ]] || grep -q '^# Looks like' <<<"$output"; then
    echo "✗ $name : $passed/$planned" >&2
    grep -E '^(not ok|#)' <<<"$output" >&2 || true
    failed=$((failed + 1))
  else
    echo "✓ $name : $passed/$planned"
  fi
done

if [[ "$failed" != "0" ]]; then
  echo "Tests base : $failed fichier(s) en échec" >&2
  exit 1
fi
echo "Tests base : $total assertions, toutes vertes"
