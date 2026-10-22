import postgres from "postgres";
import { existsSync } from "node:fs";
import { join } from "node:path";

const envPath = join(process.cwd(), "..", "..", ".env");
if (existsSync(envPath) && !process.env.DATABASE_URL)
  process.loadEnvFile(envPath);

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL is not set — copy .env.example to .env");

/**
 * Single pooled client, cached on globalThis so Next's dev hot-reload doesn't
 * open a new pool on every module reload.
 *
 * `prepare: false` is required, not optional: in production this connects through
 * Supabase's Supavisor **transaction** pooler (port 6543), which multiplexes
 * connections per-statement and therefore cannot support prepared statements.
 * Connecting to port 5432 from serverless functions exhausts connections instead.
 */
const g = globalThis as unknown as { __sql?: postgres.Sql };

/**
 * Whether this process is one of `next build`'s workers. Next sets NEXT_PHASE
 * before it starts them, and they inherit it.
 */
const building = process.env.NEXT_PHASE === "phase-production-build";

export const sql =
  g.__sql ??
  postgres(url, {
    // Per process, not per build. `next build` runs one worker per core, each
    // with a pool of its own, so 8 here was up to 72 connections from a build
    // on a 10-core machine. That exhausted a local Postgres (max_connections
    // 100) whenever a server or a test run was also connected, and a page
    // that timed out connecting was a page that built broken (exit 0, then a
    // 500). Two per worker keeps a build to about 20; the pages queue on them,
    // which costs a build seconds rather than connections. A server keeps 8.
    max: building ? 2 : 8,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    // taxa.id and friends are bigserial. postgres.js returns int8 as a *string* by
    // default to avoid precision loss — safe, but it silently breaks `===` against
    // numbers in JS and JSON round-trips. Our ids are far below 2^53, so parse them
    // as numbers and keep the type annotations honest.
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (v: number | string | bigint) => String(v),
        parse: (v: string) => Number(v),
      },
    },
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== "production") g.__sql = sql;

/**
 * Run a query as the least-privilege `web_anon` role.
 *
 * This is the enforcement point for the whole location-privacy design. `web_anon`
 * can reach `reports_public` and `report_ai_suggestions` but has no grant on the
 * `reports` base table, so a public code path that accidentally selects a true
 * coordinate fails loudly instead of leaking one.
 *
 * `set local` is scoped to the transaction, so the role reverts on commit and the
 * pooled connection is never left in a restricted state.
 */
export async function asPublic<T>(
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`set local role web_anon`;
    // No public read may hold a pooled connection for long. Neither role had a
    // timeout, and a long search term made one directory request cost 2-4 s
    // of database time (security audit, 29 September 2026). The slowest real
    // public read, the country-wide map tile, takes tens of milliseconds.
    await tx`set local statement_timeout = '8s'`;
    return fn(tx);
  }) as Promise<T>;
}
