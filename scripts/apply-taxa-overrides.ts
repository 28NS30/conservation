/**
 * Apply scripts/taxa-overrides.csv to `taxon_precision_floors`.
 *
 *   npm run apply:overrides              # against DATABASE_URL
 *   npm run apply:overrides -- --dry-run # say what would change, change nothing
 *
 * Migration 0014 created the table and loaded the file as it stood then. Run
 * this after editing the file; the table's trigger re-blurs the records a new
 * or raised floor covers, in the same transaction.
 *
 * It only ever TIGHTENS. A line that is stricter than the database, or new,
 * is written. A line that would lower an existing floor is refused and
 * reported, and a floor in the database that the file no longer lists is
 * reported and left in place. Lowering or removing a floor publishes locations
 * that were withheld, which is a decision for the owner, taken in SQL on
 * purpose — not something a file edit should do as a side effect.
 */
import { sql } from "./db.ts";
import { readOverrides } from "./taxa-overrides.ts";

const RANK: Record<string, number> = {
  exact: 0,
  coarse_10km: 1,
  coarse_50km: 2,
  suppressed: 3,
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const wanted = readOverrides();

  const current = new Map(
    (
      await sql<{ taicol_id: string; min_precision: string; reason: string }[]>`
        select taicol_id, min_precision, reason from taxon_precision_floors`
    ).map((r) => [r.taicol_id, r]),
  );
  const known = new Set(
    (
      await sql<{ taicol_id: string }[]>`
        select taicol_id from taxa
         where taicol_id = any(${wanted.map((w) => w.taicol_id)})`
    ).map((r) => r.taicol_id),
  );

  let changed = 0;
  let refused = 0;
  await sql.begin(async (tx) => {
    for (const w of wanted) {
      const have = current.get(w.taicol_id);
      if (have && RANK[w.min_precision] < RANK[have.min_precision]) {
        refused++;
        console.log(
          `  REFUSED ${w.taicol_id}: the file says ${w.min_precision}, the database ` +
            `has ${have.min_precision}. Lowering a floor un-blurs records; do it in SQL if it is meant.`,
        );
        continue;
      }
      if (!known.has(w.taicol_id))
        console.log(
          `  note    ${w.taicol_id} is not in taxa yet; the floor applies once it is`,
        );
      if (have?.min_precision === w.min_precision && have.reason === w.reason) continue;
      changed++;
      const verb = !have ? "add    " : have.min_precision === w.min_precision ? "reword " : "raise  ";
      console.log(
        `  ${verb} ${w.taicol_id} ${have?.min_precision ?? "—"} -> ${w.min_precision}`,
      );
      if (!dryRun)
        await tx`
          insert into taxon_precision_floors (taicol_id, min_precision, reason)
          values (${w.taicol_id}, ${w.min_precision}, ${w.reason})
          on conflict (taicol_id) do update
             set min_precision = excluded.min_precision,
                 reason        = excluded.reason,
                 updated_at    = now()`;
    }
  });

  const listed = new Set(wanted.map((w) => w.taicol_id));
  for (const [id, row] of current)
    if (!listed.has(id))
      console.log(
        `  kept    ${id} (${row.min_precision}) is in the database but not in the file`,
      );

  console.log(
    `\n${dryRun ? "Would change" : "Changed"} ${changed}; refused ${refused}; ` +
      `${wanted.length} in the file.`,
  );
  await sql.end();
  if (refused > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await sql.end();
  process.exit(1);
});
