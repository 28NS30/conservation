import postgres from "postgres";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const envPath = join(ROOT, ".env");
if (existsSync(envPath) && !process.env.DATABASE_URL) process.loadEnvFile(envPath);

export const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

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
