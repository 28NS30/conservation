import postgres from "postgres";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const envPath = join(ROOT, ".env");
if (existsSync(envPath) && !process.env.DATABASE_URL) process.loadEnvFile(envPath);

export const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

/** GitHub Actions sets CI=true on every step. */
export const IN_CI = /^(1|true)$/i.test(process.env.CI ?? "");

let serverSeen = false;

/**
 * For a test that needs the app: true when it answers at BASE_URL.
 *
 *   test("…", async (t) => {
 *     if (!(await requireServer(t))) return;
 *
 * Off CI, a missing server skips the test, so one file can be run with
 * `node --test` and nothing listening. Under CI it throws. CI starts the
 * server before the suite, so a missing one is a broken run, and a skip is
 * printed beside the passes and read as one: these checks used to carry their
 * own copies of the probe, each ending in t.skip, and a run where the server
 * never came up would have been green.
 *
 * Without a `t` (a `before` hook) it neither skips nor throws off CI, and the
 * caller decides; under CI it still throws.
 */
export async function requireServer(t) {
  if (!serverSeen) {
    serverSeen = await fetch(BASE_URL).then(
      async (res) => {
        await res.body?.cancel().catch(() => {});
        return true;
      },
      () => false,
    );
  }
  if (serverSeen) return true;
  if (IN_CI) {
    throw new Error(
      `no server at ${BASE_URL}. CI starts it before the suite, so this is a failure here, not a skip.`,
    );
  }
  t?.skip(`no server at ${BASE_URL}`);
  return false;
}

export const sql = postgres(process.env.DATABASE_URL, {
  max: 4,
  prepare: false,
  onnotice: () => {},
  types: {
    bigint: { to: 20, from: [20], serialize: String, parse: Number },
  },
});

/**
 * Run a test body inside a transaction that is always rolled back.
 *
 * Tests insert reports to exercise the obscuring trigger; rolling back keeps the
 * dev database clean and means tests can run repeatedly without accumulating junk.
 */
export async function inRollback(fn) {
  const marker = Symbol("rollback");
  try {
    await sql.begin(async (tx) => {
      await fn(tx);
      throw marker;
    });
  } catch (e) {
    if (e !== marker) throw e;
  }
}

/** A taxon id matching the given predicate, for building fixtures. */
export async function taxonWhere(clause) {
  const [row] = await sql`select id from taxa where ${sql.unsafe(clause)} limit 1`;
  if (!row) throw new Error(`no taxon matching: ${clause}`);
  return row.id;
}

export async function insertReport(tx, { taxonId = null, lng = 120.9, lat = 23.8, category = "roadkill", override = null, status = "published" } = {}) {
  const [row] = await tx`
    insert into reports (category, location, location_public, observed_at, taxon_id,
                         taxon_source, status, source, precision_override)
    values (${category},
            st_setsrid(st_makepoint(${lng}, ${lat}), 4326)::geography,
            st_setsrid(st_makepoint(${lng}, ${lat}), 4326)::geography,
            now(), ${taxonId}, 'imported', ${status}, 'user', ${override})
    returning id, location_precision, is_obscured,
              st_distance(location, location_public) as offset_m,
              st_x(location_public::geometry) as pub_lng,
              st_y(location_public::geometry) as pub_lat,
              st_x(location::geometry) as true_lng,
              st_y(location::geometry) as true_lat`;
  return row;
}
