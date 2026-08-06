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

export const sql =
  g.__sql ??
  postgres(url, {
    // Per process, not per build. `next build` prerenders ~834 species pages
    // across 9 workers, so this is really up to 72 concurrent connections — it
    // exhausted a local Postgres (max_connections 100) once the dev server's own
    // 32 were also open. Supabase's transaction pooler absorbs that comfortably,
    // but if a production build ever fails with SQLSTATE 53300 rather than an
    // auth error, this number is why.
    max: 8,
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
    return fn(tx);
  }) as Promise<T>;
}
