import { MIGRATIONS } from "./latestMigration.ts";

/**
 * Has production recorded every migration this build was written against?
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
 * Every file is asked for by name, not the highest number, because the
 * numbers are not applied in order. Each is reserved by the branch that writes
 * it, and the rule is that a branch's migration is applied to production, with
 * its ledger row, before the branch merges. So at any commit on main every
 * file in the directory has a row, in whatever order the numbers arrived:
 * 0036 merging before 0033, or 0032 after 0036. Asking only for the highest
 * would have let 0032, a blur-tightening migration with no shape check of its
 * own, go unapplied with health green.
 *
 * What is not asked, deliberately:
 *   - A number with no file. 0020 was never written (production's ledger has
 *     no 0020 either, read on 25 October 2026), and a number reserved by a
 *     branch that has not merged has no file here yet. Only files are asked
 *     for, so a gap needs no list of exceptions.
 *   - A ledger row with no file: production may be ahead of this build, which
 *     is exactly what the apply-before-merge rule produces for a moment.
 *
 * By the whole file name, so two branches that picked the same number are
 * each asked for; a row written with or without the `.sql` both count, as the
 * runner (scripts/migrate.ts) writes it with and a hand-applied row might not.
 *
 * Only in production. CI builds its database by looping psql over the files,
 * which writes no ledger at all, and a laptop's database has its migrations
 * applied by hand with psql, so its ledger stops wherever someone last ran
 * the runner. Asked there, the ledger would report every new migration as
 * missing and turn /api/health red on a database that has it.
 */
export type LedgerEnv = { VERCEL_ENV?: string; [key: string]: string | undefined };

export function ledgerKept(env: LedgerEnv = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

/** A migration's file name, as scripts/latest-migration.mjs takes them. */
const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

/**
 * The files the ledger has no row for. $1 is the file names; every one ends
 * in `.sql`, so `left(m, -4)` is the name without it.
 */
export const LEDGER_MISSING = `
  select coalesce(array_agg(m order by m), '{}') as missing
    from unnest($1::text[]) m
   where not exists (select 1 from _migrations l where l.name in (m, left(m, -4)))`;

export type LedgerCheck = { sql: string; params: [string[]] };

export function ledgerCheck(
  migrations: readonly string[] = MIGRATIONS,
  env: LedgerEnv = process.env,
): LedgerCheck | null {
  if (!ledgerKept(env)) return null;
  const bad = migrations.find((m) => !MIGRATION_FILE.test(m));
  if (bad !== undefined) throw new Error(`not a migration file name: ${JSON.stringify(bad)}`);
  if (!migrations.length) throw new Error("no migrations to ask the ledger for");
  return { sql: LEDGER_MISSING, params: [[...migrations]] };
}

/** What /api/health's operator answer names for each file the ledger lacks. */
export function ledgerMissingName(file: string): string {
  return `${file.replace(/\.sql$/, "")} is recorded in the migration ledger`;
}

/** Named when the ledger cannot be read at all. */
export const LEDGER_UNREADABLE = "the migration ledger can be read";
