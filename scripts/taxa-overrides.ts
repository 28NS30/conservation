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
