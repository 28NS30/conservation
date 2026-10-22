import { LATEST_MIGRATION } from "./latestMigration.ts";

/**
 * Has production recorded the newest migration this build was written
 * against?
 *
 * The checks in lib/schemaStatus.ts ask about the shape a migration leaves,
 * and each has to be written by hand; a migration nobody wrote a check for is
 * invisible to them. Production's `_migrations` ledger is kept now: it was
 * baselined, and every migration since 0014 has been applied through the
 * Management API in one transaction ending in its own ledger row
 * (docs/production-state.md). So in production the ledger can answer the
 * question the hand-written checks cannot, for every migration, without
 * anyone remembering to add one.
 *
 * Only in production. CI builds its database by looping psql over the files,
 * which writes no ledger at all, and a laptop's database has its migrations
 * applied by hand with psql, so its ledger stops wherever someone last ran
 * the runner. Asked there, the ledger would report every new migration as
 * missing and turn /api/health red on a database that has it.
 *
 * Matched on the number, not the whole name, so a ledger row written with or
 * without the `.sql` cannot decide the answer. The SQL is built from the
 * generated name, which scripts/latest-migration.mjs takes only from a file
 * name of digits, lower case letters and underscores.
 */
export type LedgerEnv = { VERCEL_ENV?: string; [key: string]: string | undefined };

export function ledgerKept(env: LedgerEnv = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

export function ledgerCheck(
  latest: string = LATEST_MIGRATION,
  env: LedgerEnv = process.env,
): { name: string; sql: string } | null {
  if (!ledgerKept(env)) return null;
  const number = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(latest)?.[1];
  if (!number) throw new Error(`not a migration file name: ${JSON.stringify(latest)}`);
  return {
    name: `${number} is recorded in the migration ledger`,
    sql: `select exists (select 1 from _migrations where left(name, 5) = '${number}_') as ok`,
  };
}
