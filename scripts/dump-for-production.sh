#!/usr/bin/env bash
#
# Produce a production-ready dump of the local database.
#
#   ./scripts/dump-for-production.sh            # -> data/export/production.sql
#   ./scripts/dump-for-production.sh /tmp/x.sql
#
# WHY A DUMP RATHER THAN RE-RUNNING THE IMPORTERS
#
# `taxa.id` is a bigserial, and the embedding matrix baked into the Modal volume
# stores those ids. Re-running the TaiCOL import against a fresh database assigns
# ids by insertion order, so any upstream change — a taxon added, removed or
# reordered — shifts them. The classifier would then map its embeddings onto the
# wrong rows and confidently return the WRONG SPECIES, with nothing logging an
# error anywhere.
#
# Restoring a dump keeps the ids byte-identical. It is also far faster: the
# TaiCOL crawl takes ~4 minutes and the GBIF crawl takes hours, against ~140 MB
# of SQL that restores in a minute.
#
# `npm run preflight` verifies the alignment afterwards either way.
set -euo pipefail

OUT="${1:-data/export/production.sql}"
CONTAINER="${PG_CONTAINER:-supabase_db_conservation}"

mkdir -p "$(dirname "$OUT")"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "Postgres container '$CONTAINER' is not running. Start it with: npm run db:up" >&2
  exit 1
fi

echo "Dumping the public schema from '$CONTAINER'…"

# DATA ONLY. The migrations are the source of truth for the schema and are
# designed to run against an empty database — they also create the `web_anon`
# role, the grants and the RLS policies, none of which a schema dump carries
# (roles are cluster-level, and grants need --no-privileges off, which then
# collides with Supabase's own ownership).
#
# Dumping the schema as well was tried and is worse: migration 0001 then fails
# with "relation taxa already exists", so the sequence cannot be
# restore-then-migrate, and migrate-then-restore double-creates everything.
# Schema from migrations, rows from here.
# spatial_ref_sys is excluded because it belongs to the PostGIS extension, not to
# this project. Restoring it needs superuser, which a managed Supabase project
# does not give you, and the failure aborts the whole load partway through —
# leaving a database that looks half-populated. PostGIS creates it itself.
docker exec "$CONTAINER" pg_dump \
  --username postgres \
  --dbname postgres \
  --schema public \
  --data-only \
  --no-owner \
  --no-privileges \
  --quote-all-identifiers \
  --exclude-table='public.spatial_ref_sys' \
  > "$OUT"

BYTES=$(wc -c < "$OUT" | tr -d ' ')
echo "wrote $OUT ($(echo "$BYTES" | awk '{printf "%.0f MB", $1/1048576}'))"
cat <<EOF

Restore into a Supabase project.

FIRST enable the extensions the schema depends on, or the restore aborts partway
on a missing operator class and leaves a half-populated database:

  psql "\$PROD_DIRECT_URL" -c 'create extension if not exists postgis;' \\
                           -c 'create extension if not exists pg_trgm;'

Then restore:

  psql "\$PROD_DIRECT_URL" -v ON_ERROR_STOP=1 -f $OUT

Use the project's DIRECT connection string (port 5432) for the restore, not the
transaction pooler on 6543 — the pooler cannot run the multi-statement session a
restore needs. The app itself uses the pooler; the restore does not.
EOF
