/**
 * The committed list of precision floors, scripts/taxa-overrides.csv.
 *
 * A floor is a local minimum blur for one TaiCOL id, kept in
 * `taxon_precision_floors` (migration 0014), which the TaiCOL import never
 * writes. The CSV is the reviewable source: one line per animal, and a reason
 * a stranger could check. This module only reads it, so the test suite and
 * apply-taxa-overrides.ts parse it the same way.
 *
 *   taicol_id,min_precision,reason
 *   t0028707,coarse_10km,"臺灣蛇蜥 … class II under its old name …"
 *
 * Standard CSV: a field containing a comma or a quote is quoted, and a quote
 * inside it is doubled.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const OVERRIDES_CSV = join(
  dirname(fileURLToPath(import.meta.url)),
  "taxa-overrides.csv",
);

/** Mirrors the CHECK on taxon_precision_floors.min_precision. 'exact' is not a floor. */
export const FLOOR_PRECISIONS = ["coarse_10km", "coarse_50km", "suppressed"] as const;

export type Floor = {
  taicol_id: string;
  min_precision: (typeof FLOOR_PRECISIONS)[number];
  reason: string;
};

/** One CSV record into fields. Enough CSV for this file; not a general parser. */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  if (quoted) throw new Error(`unterminated quote in: ${line}`);
  out.push(cur);
  return out;
}

/**
 * Parse and validate. Throws on anything malformed, naming the line: a floor
 * that silently failed to load is a blur that silently is not there.
 */
export function parseOverrides(text: string): Floor[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const [header, ...rows] = lines;
  if (header?.trim() !== "taicol_id,min_precision,reason")
    throw new Error(`unexpected header: ${header}`);

  const seen = new Set<string>();
  return rows.map((line, i) => {
    const where = `taxa-overrides.csv line ${i + 2}`;
    const f = fields(line);
    if (f.length !== 3) throw new Error(`${where}: expected 3 fields, got ${f.length}`);
    const [taicol_id, min_precision, reason] = f.map((s) => s.trim());
    if (!/^t\d{7}$/.test(taicol_id))
      throw new Error(`${where}: "${taicol_id}" is not a TaiCOL taxon id`);
    if (!(FLOOR_PRECISIONS as readonly string[]).includes(min_precision))
      throw new Error(
        `${where}: min_precision must be one of ${FLOOR_PRECISIONS.join(", ")}`,
      );
    if (!reason) throw new Error(`${where}: a floor needs a reason`);
    if (seen.has(taicol_id)) throw new Error(`${where}: ${taicol_id} is listed twice`);
    seen.add(taicol_id);
    return { taicol_id, min_precision: min_precision as Floor["min_precision"], reason };
  });
}

export function readOverrides(path: string = OVERRIDES_CSV): Floor[] {
  return parseOverrides(readFileSync(path, "utf8"));
}

/**
 * TaiCOL's own record of which row replaced each retired one (new_taxon_id,
 * kept since migration 0034), as `(taicol_id, new_taicol_id)`.
 */
export const SUCCESSORS_IN_TAXA = `
  select taicol_id, new_taicol_id from taxa
   where taxon_status = 'deleted' and new_taicol_id is not null`;

/**
 * Every name in use that has a retired twin, with the rule each one gives.
 *
 * TaiCOL retires a name by keeping its row and marking it `deleted`, and its
 * sensitivity rating sometimes stays on that row while the accepted row for the
 * same plant or animal carries none: 黃頸蝠 is t0072234, accepted and unrated,
 * beside t0102479, deleted and rated 縣市. The picker, the report form and the
 * directory offer accepted names only, so a rating left on the retired row
 * reaches nobody — every person who names the animal publishes it to the
 * metre. Each such pair needs a floor on the accepted row; `looser` marks the
 * ones still without one.
 *
 * A twin is the row TaiCOL says replaced the deleted one, or a row with the
 * same scientific name or the same Chinese name as it.
 *
 * TaiCOL's pointer is the only thing that catches a rename. 鉛色水蛇 Enhydris
 * plumbea, rated 座標不開放, became 韋氏水蛇 Hypsiscopus wettsteini, which is
 * only protected class III, and neither name matches the other: matched by
 * name only, the check passed while the snake's 29 records went from hidden
 * to 10 km. The pointer also finds a rated species TaiCOL folded into a
 * broader one (短葶雙葉蘭 Neottia breviscapa into 大花雙葉蘭 Neottia wardii),
 * where a floor blurs every record of the broader species, so it is the
 * owner's to decide. It is followed through rows that were themselves retired
 * later, so a name moved twice still reaches the row in use, and taken
 * wherever TaiCOL says the successor lives: it names the same plant or
 * animal, and the classifier can name any accepted row
 * (RESOLVE_CANDIDATES_SQL). `by_successor` marks the pairs it found.
 *
 * Names catch what TaiCOL left without a pointer, and a genus it moved
 * (紅鶴頂蘭 was retired as Phaius tankervilleae and is now Calanthe
 * tankervilleae). Matching on the Chinese name can also pair two different
 * taxa that share one; the answer is then a floor that over-blurs, which is
 * the side to be wrong on. Kingdoms must agree where both are known, as in
 * binomial_precision (migration 0014).
 *
 * Deleted rows only. An accepted row outside Taiwan that shares a Chinese name
 * is, by TaiCOL's own account, a different animal (巢鼠 is also Australia's
 * stick-nest rat); the one case where the law disagrees, 臺灣蛇蜥, has a floor
 * of its own.
 *
 * `successors` is where the pointers come from: the column, or, for a database
 * that does not have it filled yet, a snapshot's (scripts/retired-twins.ts
 * --from).
 *
 * Run by test/stricter-wins.test.mjs and by scripts/preflight.ts, so a TaiCOL
 * refresh that adds a pair is caught before a report is filed under it.
 */
export function retiredTwinsSql(successors: string = SUCCESSORS_IN_TAXA): string {
  return `
  with recursive pointer (taicol_id, new_taicol_id) as (${successors}),
  successor (retired_taicol_id, taicol_id, hops) as (
    select taicol_id, new_taicol_id, 1 from pointer
    union all
    -- A depth limit against a cycle in the source data, as in taxon_precision().
    select s.retired_taicol_id, p.new_taicol_id, s.hops + 1
      from successor s
      join pointer p on p.taicol_id = s.taicol_id
     where s.hops < 6
  )
  select p.taicol_id, p.scientific_name, p.retired_taicol_id, p.retired_scientific_name,
         p.by_successor,
         taxon_precision(p.id) as precision,
         taxon_precision(p.retired_id) as retired_precision,
         precision_rank(taxon_precision(p.retired_id)) > precision_rank(taxon_precision(p.id)) as looser
    from (
      select n.id, n.taicol_id, n.scientific_name,
             d.id as retired_id, d.taicol_id as retired_taicol_id,
             d.scientific_name as retired_scientific_name, true as by_successor
        from successor s
        join taxa d on d.taicol_id = s.retired_taicol_id
        join taxa n on n.taicol_id = s.taicol_id
       where d.taxon_status = 'deleted'
         and n.taxon_status = 'accepted'
         and (n.rank = 'Species' or is_infraspecific(n.rank))
      union all
      select n.id, n.taicol_id, n.scientific_name,
             d.id, d.taicol_id, d.scientific_name, false
        from taxa d
        join taxa n on (lower(n.scientific_name) = lower(d.scientific_name)
                        or n.common_name_zh = d.common_name_zh)
                   and (d.kingdom is null or n.kingdom is null or d.kingdom = n.kingdom)
       where d.taxon_status = 'deleted'
         and n.taxon_status = 'accepted'
         and n.is_in_taiwan
         and (n.rank = 'Species' or is_infraspecific(n.rank))
         -- Once a pair: one TaiCOL also links by id is listed above.
         and not exists (select 1 from successor s
                          where s.retired_taicol_id = d.taicol_id
                            and s.taicol_id = n.taicol_id)
    ) p`;
}

export const RETIRED_TWINS_SQL = retiredTwinsSql();
