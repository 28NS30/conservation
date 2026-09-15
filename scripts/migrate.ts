/**
 * Minimal forward-only migration runner.
 * Applies supabase/migrations/*.sql in filename order, once each, in a transaction.
 *
 *   npm run db:migrate
 *   npm run db:migrate -- --baseline   (see below)
 *
 * PRODUCTION WAS NOT CREATED BY THIS RUNNER. docs/launch-checklist.md builds it
 * by looping psql over the same files, which never writes `_migrations` — so on
 * that database this runner believes nothing has ever been applied, starts at
 * 0001, hits `create table taxa` against an existing table, and aborts having
 * applied nothing. The failure reads like a broken migration rather than a
 * bookkeeping gap, which is how 0009 and 0010 sat unapplied while the deployed
 * code wrote columns that did not exist.
 *
 * So: a database with our schema and an empty `_migrations` is refused with an
 * explanation rather than attempted, and `--baseline` records every file as
 * applied WITHOUT running any of it, which is the one-time step that makes the
 * two paths one path. Baseline only a database you know already has the schema
 * those files describe.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db.ts";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

async function main() {
  await sql`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;

  const applied = new Set(
    (await sql<{ name: string }[]>`select name from _migrations`).map((r) => r.name),
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const baseline = process.argv.includes("--baseline");

  // Does this database already have the schema, without any record of it?
  const [{ exists: hasSchema }] = await sql<{ exists: boolean }[]>`
    select exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = 'reports') as exists`;

  if (baseline) {
    for (const file of files) {
      if (applied.has(file)) continue;
      await sql`insert into _migrations (name) values (${file})`;
      console.log(`  ▣ ${file} (recorded, not run)`);
    }
    console.log(
      "\nBaselined. Re-run without --baseline to apply anything genuinely new.",
    );
    await sql.end();
    return;
  }

  if (hasSchema && applied.size === 0) {
    console.error(
      [
        "",
        "This database has the schema but no migration history, so every file",
        "looks unapplied and 0001 would fail against tables that already exist.",
        "It was almost certainly created with the psql loop in",
        "docs/launch-checklist.md.",
        "",
        "If its schema matches the files up to a point, record them and carry on:",
        "",
        "  npm run db:migrate -- --baseline   # records ALL files as applied",
        "",
        "If it is genuinely behind, apply the missing files directly first —",
        "each is written to be safe to re-run — then baseline:",
        "",
        "  psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -f supabase/migrations/<file>.sql",
        "",
        "/api/health reports schemaCurrent and names what is missing.",
      ].join("\n"),
    );
    await sql.end();
    process.exit(2);
  }

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  ✓ ${file} (already applied)`);
      continue;
    }
    const body = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    process.stdout.write(`  → ${file} ... `);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into _migrations (name) values (${file})`;
    });
    console.log("done");
    ran++;
  }

  console.log(ran ? `\nApplied ${ran} migration(s).` : "\nNothing to apply.");
  await sql.end();
}

main().catch(async (err) => {
  console.error("\nMigration failed:\n", err);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
