/**
 * Minimal forward-only migration runner.
 * Applies supabase/migrations/*.sql in filename order, once each, in a transaction.
 *
 *   npm run db:migrate
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
