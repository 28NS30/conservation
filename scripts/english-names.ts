/**
 * English common names: the rules, shared by the build, the import and the tests.
 *
 * TaiCOL has no English names, so they come from outside it, in two steps:
 *
 *   scripts/build-english-names.ts   network. Asks each source, applies the
 *                                    rules below, writes english-names.json.
 *   scripts/import-english-names.ts  database only. Applies that file, then the
 *                                    team's overrides, to `taxa`.
 *
 * Everything that decides what an animal is called in English lives here, with
 * no database connection and no network, so the tests can hold the rules to
 * account without either — the same split as taxon-names.ts.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { TransactionSql } from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));

export const NAMES_PATH = join(HERE, "english-names.json");
export const OVERRIDES_PATH = join(HERE, "english-names-overrides.csv");
export const AVILIST_CSV = join(HERE, "sources", "avilist-v2025b-species.csv");
export const MDD_CSV = join(HERE, "sources", "mdd-v2.5-names.csv");

/** The only values `common_name_en_source` may hold. */
export const SOURCE_PATTERN =
  /^(?:avilist-v2025b:(?:clements-v2025|avilist)|mdd-v2\.5|inat-\d{4}-\d{2}|col-2026-09-11|curated)$/;

/** One taxon in english-names.json. */
export type NameEntry = {
  /** TaiCOL's name, for a human reading the file. Not used by the import. */
  scientific_name: string;
  common_name_zh: string | null;
  /** The display name, or null when no source names it acceptably. */
  name: string | null;
  /** Other English names, for search. Empty when there are none. */
  alts: string[];
  /** Which source and version gave `name`, e.g. "mdd-v2.5". Null with `name`. */
  source: string | null;
  /** The scientific name the source matched, when it is not TaiCOL's own. */
  via: string | null;
  /**
   * Set on a subspecies (or variety, form) showing its species' name: the
   * species' taicol_id. The import resolves the name through it AFTER applying
   * overrides, so an override on a species reaches its subspecies too.
   */
  inherited_from?: string;
  /** Why a taxon has no name, for whoever reviews the gaps. */
  why?: string;
};

export type NamesFile = {
  generated_by: string;
  generated_at: string;
  scope: string;
  sources: Record<string, Record<string, string>>;
  /** Keyed by taicol_id. */
  names: Record<string, NameEntry>;
};

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes.
 * Written out rather than imported because the scripts package has no CSV
 * dependency and this is the whole of what one would be used for.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** CSV rows as objects keyed by the header row. */
export function csvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  return rows.map((r) =>
    Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])),
  );
}

// ---------------------------------------------------------------------------
// Matching: when a different scientific name is still the same animal
// ---------------------------------------------------------------------------

/** Latin gender and form endings, longest first. */
const ENDINGS = ["ensis", "ense", "us", "um", "is", "os", "on", "a", "e"];

/**
 * A species epithet with its gender ending removed, so that the same epithet in
 * a different genus compares equal: catesbeianus / catesbeiana, flavipunctatus /
 * flavipunctata, sinensis / sinense, niger / nigra.
 */
export function epithetStem(epithet: string): string {
  const e = epithet
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  // -er / -ra / -rum is one adjective (niger, nigra, nigrum): keep the r.
  if (e.endsWith("er")) return e.slice(0, -2) + "r";
  for (const end of ENDINGS) {
    if (e.length > end.length + 2 && e.endsWith(end)) return e.slice(0, -end.length);
  }
  return e;
}

/** Genus and epithet of a name, ignoring a "(Subgenus)" and rank markers. */
export function nameParts(name: string): string[] {
  return name
    .trim()
    .split(/\s+/)
    .filter((w) => !/^\(.*\)$/.test(w))
    .filter((w) => !/^(?:subsp|ssp|var|f|forma|subvar)\.?$/i.test(w));
}

/**
 * The names under which a source may be asked about a taxon, besides its own.
 *
 * TaiCOL lists every name its taxon has been known by, and some of those are
 * different animals: "Melogale moschata" is on the list for Taiwan's
 * ferret-badger, *Melogale subaurantiaca*, because that was once filed as its
 * subspecies — and GBIF, retrying through it, named 747 Taiwanese records
 * after the Chinese ferret-badger. The research behind this found seven such
 * cases (Melogale moschata, Rhabdophis tigrinus, Petaurista petaurista, Mus
 * caroli, Saxicola maurus, Crocidura rapax, Petaurista alborufus).
 *
 * The rule that separates them: a synonym is followed only when it keeps the
 * species epithet, allowing for gender. A genus move keeps it (Ixobrychus
 * sinensis → Botaurus sinensis, Lithobates catesbeianus → Aquarana
 * catesbeiana); a lump or a re-identification does not. A trinomial synonym
 * whose subspecies epithet is ours is the same animal before it was raised to a
 * species (Eptesicus serotinus pachyomus → Eptesicus pachyomus), so its genus
 * and that epithet are tried too.
 */
export function synonymCandidates(accepted: string, synonyms: string[]): string[] {
  const [, epithet] = nameParts(accepted);
  if (!epithet) return [];
  const stem = epithetStem(epithet);
  const self = accepted.trim().toLowerCase();
  const out: string[] = [];
  const seen = new Set<string>([self]);
  const add = (genus: string, ep: string) => {
    const b = `${genus} ${ep}`;
    if (!seen.has(b.toLowerCase())) {
      seen.add(b.toLowerCase());
      out.push(b);
    }
  };
  for (const syn of synonyms) {
    const p = nameParts(syn);
    if (p.length < 2 || !/^[A-Z]/.test(p[0])) continue;
    if (epithetStem(p[1]) === stem) add(p[0], p[1]);
    else if (p.length >= 3 && epithetStem(p[2]) === stem) add(p[0], p[2]);
  }
  return out;
}

/**
 * Whether two authorities name the same act of naming: an author in common,
 * and years at most one apart. Null when either lacks a year, so there is
 * nothing to compare.
 *
 * This is what tells a subspecies raised to a species from a different animal
 * that happens to share its genus and epithet. Merging genera makes such
 * collisions (secondary homonyms): Taiwan's brown-eared bulbul *Microscelis
 * amaurotis harterti* Kuroda, 1922 and the Banggai golden bulbul *Hypsipetes
 * harterti* (Stresemann, 1912) are two names, and the author says so. A year
 * apart is allowed because checklists disagree about publication dates:
 * TaiCOL dates Bryde's whale Olsen, 1913, and MDD Olsen, 1912.
 */
export function sameAuthority(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const year = (s: string) => s.match(/\b(1[5-9]\d\d|20\d\d)\b/)?.[1] ?? null;
  const ya = a ? year(a) : null;
  const yb = b ? year(b) : null;
  if (!ya || !yb) return null;
  if (Math.abs(Number(ya) - Number(yb)) > 1) return false;
  const stop = new Set(["von", "van", "der", "den", "del", "and", "et", "in", "ex"]);
  const names = (s: string) =>
    new Set(
      s
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 3 && !stop.has(w)),
    );
  const na = names(a!);
  return [...names(b!)].some((w) => na.has(w));
}

/** True when two binomials share their epithet (allowing for gender). */
export function sameEpithet(a: string, b: string): boolean {
  const ea = nameParts(a)[1];
  const eb = nameParts(b)[1];
  return !!ea && !!eb && epithetStem(ea) === epithetStem(eb);
}

// ---------------------------------------------------------------------------
// What counts as an English name
// ---------------------------------------------------------------------------

const PLACEHOLDER =
  /^(?:unknown|none|null|undefined|n\/?a|tbd|not available|no (?:english |common )?name|-+|\?+)$/i;

const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z]+/g, " ")
    .trim();

/**
 * Why `name` is not fit to show as the English name of `scientificName`, or
 * null when it is.
 *
 * These are the defects the research found in the sources it rejected — GBIF's
 * 'Mocassim chinês' and '铅色水蛇' tagged as English, 'Asian Grass Frog/Common
 * Pond Frog/…' as one name, Wikidata labels that are just the binomial — so a
 * source that starts producing them is caught here rather than on a species
 * page. The chosen sources are the first line of defence; this is the second.
 */
export function nameProblem(name: string, scientificName: string): string | null {
  const n = name.trim();
  if (!n) return "empty";
  if (PLACEHOLDER.test(n)) return "placeholder";
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(n))
    return "chinese-or-other-cjk";
  // Letters of the Latin script, spaces, apostrophes, hyphens and a full stop
  // ("St. Helena"). A slash or comma is several names in one field; a colon or
  // bracket is an annotation; a digit is a placeholder like "Species 1".
  if (/[^\p{Script=Latin}\p{M} '’.\-]/u.test(n)) return "not-a-single-english-name";
  // Not a defect of the name, but of the file: the build runs capitalise()
  // first, so a lower-case name here means a step was skipped.
  if (!/\p{Lu}/u.test(n)) return "all-lowercase";
  // A bird-banding code ("DECR" for Demoiselle Crane) or an acronym is a label,
  // not a name.
  if (n.split(/[\s-]+/).some((w) => w.length >= 2 && /^\p{Lu}+$/u.test(w))) return "code-or-acronym";
  const words = normalise(n).split(" ");
  // No English name has a word ending -ensis; iNaturalist's "Braziliensis"
  // for Geophagus brasiliensis is the epithet, misspelt.
  if (words.some((w) => w.endsWith("ensis"))) return "latin-word";
  const [genus, epithet] = normalise(nameParts(scientificName).slice(0, 2).join(" ")).split(" ");
  if (normalise(n) === `${genus} ${epithet}`) return "is-the-scientific-name";
  if (genus && epithet) {
    // Iguana iguana is "Green Iguana": one "iguana" is English, two is Latin.
    const hits =
      genus === epithet
        ? words.filter((w) => w === genus).length >= 2
        : words.includes(genus) && words.includes(epithet);
    if (hits) return "contains-the-scientific-name";
  }
  return null;
}

const MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

/**
 * A name with no capital letter at all, in title case: "common water hyacinth"
 * becomes "Common Water Hyacinth", "tree of heaven" becomes "Tree of Heaven".
 *
 * iNaturalist writes plant and insect names in lower case, as botanists do,
 * and its bird and reptile names in title case; shown side by side on one page
 * the lower-case ones read as broken. Only a name with no capital is touched —
 * "Brown spotted pitviper" is the source's own choice and stays — and only the
 * first letter after a space changes, so "mile-a-minute" is "Mile-a-minute".
 */
export function capitalise(name: string): string {
  if (/\p{Lu}/u.test(name)) return name;
  return name
    .split(" ")
    .map((w, i) => (i > 0 && MINOR_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Spellings of the same name a reader may type: grey/gray, and a hyphenated
 * compound without its hyphen ("Red Collared-Dove" / "Red Collared Dove").
 * Orthography only — never a different name — and only ever alternates, so
 * search finds the bird whichever side of the Atlantic the reader learned it on.
 */
export function spellingVariants(name: string): string[] {
  const out = new Set<string>();
  const swapped = name.replace(/\b([Gg])r([ae])y/g, (_m, g: string, v: string) =>
    `${g}r${v === "a" ? "e" : "a"}y`,
  );
  if (swapped !== name) out.add(swapped);
  for (const n of [name, swapped]) {
    // Lookarounds, not a captured letter each side: "Mile-a-minute" shares its
    // middle "a" between two hyphens, and consuming it left "Mile a-minute".
    const unhyphenated = n.replace(/(?<=\p{L})-(?=\p{L})/gu, " ");
    if (unhyphenated !== n) out.add(unhyphenated);
  }
  out.delete(name);
  return [...out];
}

/**
 * The alternates to store beside `display`: acceptable names only, no
 * duplicates (ignoring case), never the display name itself, plus the spelling
 * variants of every one of them. Order is kept, so the file diffs cleanly.
 */
export function cleanAlts(
  candidates: (string | null | undefined)[],
  display: string | null,
  scientificName: string,
): string[] {
  const seen = new Set<string>();
  if (display) seen.add(display.trim().toLowerCase());
  const out: string[] = [];
  const push = (s: string) => {
    const t = capitalise(s.trim().replace(/\s+/g, " "));
    const k = t.toLowerCase();
    if (!t || seen.has(k) || nameProblem(t, scientificName)) return;
    seen.add(k);
    out.push(t);
  };
  for (const c of candidates) if (c) push(c);
  for (const s of [display, ...out]) if (s) spellingVariants(s).forEach(push);
  return out;
}

// ---------------------------------------------------------------------------
// Overrides, and the names the database should end up holding
// ---------------------------------------------------------------------------

export type Override = {
  taicol_id: string;
  /** null = the team decided this taxon shows no English name. */
  common_name_en: string | null;
  note: string;
  reviewer: string;
};

export function parseOverrides(text: string): Override[] {
  const recs = csvRecords(text);
  const out: Override[] = [];
  const seen = new Set<string>();
  for (const r of recs) {
    const id = (r.taicol_id ?? "").trim();
    if (!id) continue;
    if (!/^t\d{7}$/.test(id)) throw new Error(`overrides: "${id}" is not a taicol_id`);
    if (seen.has(id)) throw new Error(`overrides: ${id} appears twice`);
    seen.add(id);
    const name = (r.common_name_en ?? "").trim();
    out.push({
      taicol_id: id,
      common_name_en: name || null,
      note: r.note ?? "",
      reviewer: r.reviewer ?? "",
    });
  }
  return out;
}

export function loadNamesFile(path = NAMES_PATH): NamesFile {
  return JSON.parse(readFileSync(path, "utf8")) as NamesFile;
}

export function loadOverrides(path = OVERRIDES_PATH): Override[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return parseOverrides(text);
}

/** What one row of `taxa` should hold. */
export type FinalName = {
  name: string | null;
  alts: string[] | null;
  source: string | null;
  inherited: boolean;
};

/**
 * The four English columns for every taxon the file or the overrides mention.
 *
 * Overrides win, always. A named override keeps the name it replaced as an
 * alternate, so "Mainland Leopard Cat" is still searchable after the team chose
 * "Leopard Cat". A blank override removes the name AND its alternates: a name
 * that is wrong for the animal usually came with alternates from the same wrong
 * match.
 *
 * Inheritance is resolved last, from the species' final name, so an override on
 * a species reaches every subspecies that shows the species' name — and an
 * override on the subspecies itself still beats both.
 */
export function resolveNames(file: NamesFile, overrides: Override[]): Map<string, FinalName> {
  const byId = new Map(overrides.map((o) => [o.taicol_id, o]));
  const out = new Map<string, FinalName>();

  const own = (id: string, e: NameEntry | undefined): FinalName => {
    const o = byId.get(id);
    if (o) {
      if (!o.common_name_en) return { name: null, alts: null, source: "curated", inherited: false };
      const sci = e?.scientific_name ?? "";
      const alts = cleanAlts([e?.name, ...(e?.alts ?? [])], o.common_name_en, sci);
      return { name: o.common_name_en, alts: alts.length ? alts : null, source: "curated", inherited: false };
    }
    if (!e || !e.name) return { name: null, alts: null, source: null, inherited: false };
    return {
      name: e.name,
      alts: e.alts.length ? [...e.alts] : null,
      source: e.source,
      inherited: false,
    };
  };

  for (const [id, e] of Object.entries(file.names)) {
    if (!e.inherited_from) out.set(id, own(id, e));
  }
  for (const o of overrides) {
    if (!out.has(o.taicol_id) && !file.names[o.taicol_id]?.inherited_from)
      out.set(o.taicol_id, own(o.taicol_id, file.names[o.taicol_id]));
  }
  for (const [id, e] of Object.entries(file.names)) {
    if (!e.inherited_from) continue;
    if (byId.has(id)) {
      out.set(id, own(id, e));
      continue;
    }
    const parent = out.get(e.inherited_from);
    out.set(
      id,
      parent?.name
        ? { name: parent.name, alts: parent.alts ? [...parent.alts] : null, source: parent.source, inherited: true }
        : { name: null, alts: null, source: null, inherited: false },
    );
  }
  return out;
}

export type ApplyResult = {
  /** Rows whose English columns changed. Zero on a second run. */
  changed: number;
  /** Rows that held English names the file and overrides no longer give. */
  cleared: number;
  /** taicol_ids in the file or overrides that `taxa` does not have. */
  unknown: string[];
};

/**
 * Write `final` to `taxa`, inside the caller's transaction.
 *
 * Only rows that differ are written, so a re-run changes nothing and says so.
 * Rows the file no longer mentions are cleared, so the database holds exactly
 * what the file and the overrides say, however many runs came before.
 *
 * Only the four English columns are ever set. `taxa_reblur_reports` (0012)
 * fires on UPDATE OF sensitivity or protected_status and re-blurs every report
 * of that taxon; this update must never name either column.
 */
export async function applyEnglishNames<T extends Record<string, unknown>>(
  tx: TransactionSql<T>,
  final: Map<string, FinalName>,
): Promise<ApplyResult> {
  const rows = [...final].map(([taicol_id, f]) => ({
    taicol_id,
    name: f.name,
    alts: f.alts,
    source: f.source,
    inherited: f.inherited,
  }));
  // Sent as text and cast in SQL. Bound straight to ::jsonb, postgres.js runs
  // its own JSON serializer over the string and Postgres receives one JSON
  // string rather than an array ("cannot call jsonb_to_recordset on a
  // non-array").
  const payload = JSON.stringify(rows);
  const ids = rows.map((r) => r.taicol_id);

  const unknown = await tx<{ taicol_id: string }[]>`
    select x.taicol_id
      from jsonb_to_recordset(${payload}::text::jsonb) as x(taicol_id text)
     where not exists (select 1 from taxa t where t.taicol_id = x.taicol_id)
     order by 1`;

  const changed = await tx`
    update taxa t
       set common_name_en           = x.name,
           alt_names_en             = x.alts,
           common_name_en_source    = x.source,
           common_name_en_inherited = x.inherited
      from jsonb_to_recordset(${payload}::text::jsonb)
           as x(taicol_id text, name text, alts text[], source text, inherited boolean)
     where t.taicol_id = x.taicol_id
       and (t.common_name_en, t.alt_names_en, t.common_name_en_source, t.common_name_en_inherited)
           is distinct from (x.name, x.alts, x.source, x.inherited)
    returning t.id`;

  const cleared = await tx`
    update taxa
       set common_name_en = null, alt_names_en = null,
           common_name_en_source = null, common_name_en_inherited = false
     where (common_name_en is not null or alt_names_en is not null
            or common_name_en_source is not null or common_name_en_inherited)
       and taicol_id <> all(${ids}::text[])
    returning id`;

  return {
    changed: changed.length,
    cleared: cleared.length,
    unknown: unknown.map((r) => r.taicol_id),
  };
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

/**
 * english-names.json with one taxon per line, sorted by taicol_id, so that a
 * changed name is a one-line diff a reviewer can read.
 */
export function serializeNamesFile(file: NamesFile): string {
  const { names, ...header } = file;
  const head = JSON.stringify(header, null, 2).replace(/\n}$/, "");
  const ids = Object.keys(names).sort();
  const lines = ids.map(
    (id, i) => `    ${JSON.stringify(id)}: ${JSON.stringify(names[id])}${i < ids.length - 1 ? "," : ""}`,
  );
  return `${head},\n  "names": {\n${lines.join("\n")}\n  }\n}\n`;
}
