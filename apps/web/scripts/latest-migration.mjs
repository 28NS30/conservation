#!/usr/bin/env node
/**
 * Write lib/latestMigration.ts: every file in supabase/migrations.
 *
 *   node scripts/latest-migration.mjs     (run by `prebuild`)
 *
 * /api/health asks production's `_migrations` ledger whether every migration
 * this build was written against has been applied (lib/migrationLedger.ts). A
 * deployed function cannot read the migrations directory, which is not in its
 * bundle, so the names are fixed into the code here, before every build.
 *
 * Every file, not the newest: the numbers do not arrive in order. Each is
 * reserved by the branch that writes it, and branches merge when they are
 * ready, so 0036 can be on main while 0033 is still on its branch, and 0032
 * can merge after 0036 has. The highest number says nothing about the ones
 * below it.
 *
 * The file is also committed, because CI type-checks before it builds and the
 * import has to resolve then. A branch that adds a migration commits the
 * regenerated file with it (any build regenerates it), and a merge conflict in
 * it is settled by running this again. test/monitoring.test.mjs fails while
 * the committed list and the directory differ. A stale committed copy cannot
 * reach production: Vercel's build runs `prebuild`, which writes the list from
 * the directory it is building.
 *
 * If the directory is not there (a build that copied only apps/web), the
 * committed file stands and this says so rather than failing the build.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(WEB, "..", "..", "supabase", "migrations");
const OUT = join(WEB, "lib", "latestMigration.ts");

/** A migration file's name: four digits, an underscore, lower case words. */
export const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Every migration file name in `dir`, in order; exported for the test. */
export function migrationFiles(dir = MIGRATIONS) {
  const files = readdirSync(dir)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort();
  if (!files.length) throw new Error(`no migrations in ${dir}`);
  return files;
}

export function source(files) {
  return [
    "// Written by scripts/latest-migration.mjs before every build; do not edit.",
    "// Every file in supabase/migrations, each of which lib/migrationLedger.ts asks",
    "// production's ledger for. Regenerate with `node scripts/latest-migration.mjs`.",
    "export const MIGRATIONS: readonly string[] = [",
    ...files.map((f) => `  ${JSON.stringify(f)},`),
    "];",
    "",
    "/** The highest-numbered of them, for reading at a glance; nothing is decided by it. */",
    `export const LATEST_MIGRATION = ${JSON.stringify(files.at(-1))};`,
    "",
  ].join("\n");
}

/** Run directly, as `node scripts/latest-migration.mjs`, through any symlink in the path. */
function isMain() {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  if (!existsSync(MIGRATIONS)) {
    console.warn(`[latest-migration] ${MIGRATIONS} not found; keeping the committed lib/latestMigration.ts`);
  } else {
    const files = migrationFiles();
    const next = source(files);
    const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (next !== current) {
      writeFileSync(OUT, next);
      console.log(`[latest-migration] lib/latestMigration.ts -> ${files.length} migrations, up to ${files.at(-1)}`);
    }
  }
}
