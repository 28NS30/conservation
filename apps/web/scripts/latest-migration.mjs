#!/usr/bin/env node
/**
 * Write lib/latestMigration.ts: the newest file in supabase/migrations.
 *
 *   node scripts/latest-migration.mjs     (run by `prebuild`)
 *
 * /api/health asks production's `_migrations` ledger whether the newest
 * migration this build was written against has been applied
 * (lib/migrationLedger.ts). A deployed function cannot read the migrations
 * directory, which is not in its bundle, so the name is fixed into the code
 * here, before every build.
 *
 * The file is also committed, because CI type-checks before it builds and the
 * import has to resolve then. This rewrites it only when the name changed, so
 * a build leaves the tree clean unless a migration was added without it; and
 * test/monitoring.test.mjs fails in that case, before a build has to notice.
 *
 * If the directory is not there (a build that copied only apps/web), the
 * committed file stands and this says so rather than failing the build.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(WEB, "..", "..", "supabase", "migrations");
const OUT = join(WEB, "lib", "latestMigration.ts");

/** The newest migration file name in `dir`; exported for the test. */
export function latestMigration(dir = MIGRATIONS) {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
  if (!files.length) throw new Error(`no migrations in ${dir}`);
  return files.at(-1);
}

export function source(name) {
  return [
    "// Written by scripts/latest-migration.mjs before every build; do not edit.",
    "// The newest file in supabase/migrations, which lib/migrationLedger.ts asks",
    "// production's ledger for.",
    `export const LATEST_MIGRATION = ${JSON.stringify(name)};`,
    "",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(MIGRATIONS)) {
    console.warn(`[latest-migration] ${MIGRATIONS} not found; keeping the committed lib/latestMigration.ts`);
  } else {
    const next = source(latestMigration());
    const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (next !== current) {
      writeFileSync(OUT, next);
      console.log(`[latest-migration] lib/latestMigration.ts -> ${latestMigration()}`);
    }
  }
}
