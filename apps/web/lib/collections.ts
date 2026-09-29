import type postgres from "postgres";
import { asPublic } from "@/lib/db";
import { OFFERED, countSpecies } from "@/lib/species";
import {
  RECORD_CONDITIONS,
  selectionFor,
  type Category,
  type Collection,
  type LocationPrecision,
} from "@conservation/shared";

/**
 * What the three collection pages, and /stats, say about each collection.
 *
 * Every query here reads `reports_public` as `web_anon`, like everything else a
 * visitor sees: a record withheld from the public view (座標不開放, unpublished)
 * is in no count, no list and no total, so a collection page cannot confirm
 * that a withheld animal was ever recorded. And every one applies a collection
 * through `selectionFor()`, the reading the map's tiles and the record list
 * use, so a count on a hub page is the count a reader gets by following its
 * map link.
 */

/** The filter clause every query below shares, on `reports_public rp`. */
function where(tx: postgres.TransactionSql, c: Collection) {
  const { categories, invasiveOnly } = selectionFor({ collection: c });
  return tx`(${categories}::text[] is null or rp.category = any(${categories}))
        and (not ${invasiveOnly}::boolean or rp.is_invasive)`;
}

export type CollectionSummary = {
  records: number;
  /**
   * Species among its records, counted by the species directory's own rule
   * (countSpecies), so the number agrees with the list a reader opens to check
   * it. See recordedSpeciesCount().
   */
  species: number;
  obscured: number;
  /** Records imported from open data, through GBIF. */
  imported: number;
  /** Records filed on this site. */
  filed: number;
  /** Seen alive: filed on the wildlife or invasive page. */
  alive: number;
  /** Found dead or injured: filed on the roadkill page. */
  dead: number;
  firstYear: number | null;
  lastYear: number | null;
  /** When the newest record was seen, when there is one. */
  newest: Date | string | null;
};

export async function collectionSummary(
  c: Collection,
): Promise<CollectionSummary> {
  const alive = [...RECORD_CONDITIONS.alive.categories];
  const dead = [...RECORD_CONDITIONS.dead.categories];
  const [[row], species] = await Promise.all([
    asPublic(
      (tx) => tx<Omit<CollectionSummary, "species">[]>`
      select count(*)::int                                          as records,
             count(*) filter (where rp.is_obscured)::int            as obscured,
             count(*) filter (where rp.source = 'gbif')::int        as imported,
             count(*) filter (where rp.source <> 'gbif')::int       as filed,
             count(*) filter (where rp.category = any(${alive}))::int as alive,
             count(*) filter (where rp.category = any(${dead}))::int  as dead,
             extract(year from min(rp.observed_at))::int            as "firstYear",
             extract(year from max(rp.observed_at))::int            as "lastYear",
             max(rp.observed_at)                                    as newest
        from reports_public rp
       where ${where(tx, c)}`,
    ),
    countSpecies({ filter: "recorded", collection: c }),
  ]);
  return { ...row, species };
}

/**
 * How many public records each collection holds, and how many there are in
 * all, for /stats. One pass over the view; the collections overlap, so the
 * three do not add up to the total and are not meant to.
 */
export async function collectionTotals(): Promise<
  { all: number } & Record<Collection, number>
> {
  const [row] = await asPublic(
    (tx) => tx<({ all: number } & Record<Collection, number>)[]>`
      select count(*)::int                                            as "all",
             count(*) filter (where ${where(tx, "roadkill")})::int    as roadkill,
             count(*) filter (where ${where(tx, "invasive")})::int    as invasive,
             count(*) filter (where ${where(tx, "wildlife")})::int    as wildlife
        from reports_public rp`,
  );
  return row;
}

export type CollectionRecord = {
  id: string;
  observedAt: string;
  category: Category;
  source: string;
  isObscured: boolean;
  locationPrecision: LocationPrecision;
  isInvasive: boolean;
  taxonId: number | null;
  scientificName: string | null;
  commonNameZh: string | null;
  commonNameEn: string | null;
  taicolId: string | null;
};

/**
 * The newest records in a collection, newest first by the date the animal was
 * seen. The page states that date beside each one, because on today's data
 * "newest" means 2017: calling these recent would be the claim /reports once
 * made above a first row dated 2017-12-31.
 */
export async function newestRecords(
  c: Collection,
  limit = 8,
): Promise<CollectionRecord[]> {
  return asPublic(
    (tx) => tx<CollectionRecord[]>`
      select rp.id::text, rp.observed_at as "observedAt", rp.category,
             rp.source, rp.is_obscured as "isObscured",
             rp.location_precision as "locationPrecision",
             rp.is_invasive as "isInvasive",
             rp.taxon_id as "taxonId",
             t.scientific_name as "scientificName",
             t.common_name_zh as "commonNameZh",
             t.common_name_en as "commonNameEn",
             t.taicol_id as "taicolId"
        from reports_public rp
        left join taxa t on t.id = rp.taxon_id
       where ${where(tx, c)}
       order by rp.observed_at desc, rp.id
       limit ${limit}`,
  );
}

export type InvasiveSpecies = {
  id: number;
  scientificName: string;
  commonNameZh: string | null;
  altNamesZh: string[] | null;
  commonNameEn: string | null;
  altNamesEn: string[] | null;
  taicolId: string;
  rank: string | null;
  class: string | null;
  protectedStatus: string | null;
  reportCount: number;
  /** TaiCOL's own note on the species' alien status, where the data has it. */
  note: string | null;
};

/**
 * The invasive animals a reader can look up: the species list the invasive
 * collection is defined by.
 *
 * The same three conditions as `reports_public.is_invasive` (0016) — TaiCOL's
 * invasive tag, an animal, an accepted name — narrowed to what the species
 * directory offers, species and subspecies recorded in Taiwan. So every record
 * counted here is a record in the collection, and a species appears once:
 * TaiCOL's retired duplicates, such as 多線南蜥 beside 多線真稜蜥, stay out.
 *
 * Record counts come from species_report_stats, which is built on the public
 * view, so a count can never reveal a withheld record.
 *
 * TaiCOL's note on WHY a species is on its list (its alien_status_note, which
 * for the cat cites Ho et al. and the Global Invasive Species Database) is not
 * in our copy of the checklist: the import does not keep it. It is read as
 * `to_jsonb(t) ->> 'alien_status_note'`, which is null while the column does
 * not exist and the note itself once an import adds it, so the page shows it
 * the day the data has it, with no change here and no failed query before.
 */
export async function invasiveSpeciesList(): Promise<InvasiveSpecies[]> {
  return asPublic(
    (tx) => tx<InvasiveSpecies[]>`
      select t.id, t.scientific_name as "scientificName",
             t.common_name_zh as "commonNameZh",
             t.alt_names_zh as "altNamesZh",
             t.common_name_en as "commonNameEn",
             t.alt_names_en as "altNamesEn",
             t.taicol_id as "taicolId",
             t.rank, t.class, t.protected_status as "protectedStatus",
             coalesce(s.report_count, 0)::int as "reportCount",
             nullif(trim(to_jsonb(t) ->> 'alien_status_note'), '') as note
        from taxa t
        left join species_report_stats s on s.taxon_id = t.id
       where ${tx.unsafe(OFFERED)}
         and t.rank in ('Species','Subspecies')
         and t.kingdom = 'Animalia'
         and t.is_invasive
       order by coalesce(s.report_count, 0) desc,
                t.common_name_zh nulls last, t.scientific_name, t.id`,
  );
}
