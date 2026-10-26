import type postgres from "postgres";

/**
 * A name for a record identified only above the species: 赤蛙科 Ranidae, said
 * as such, instead of the bare "Ranidae" (or "Rattus Fischer, 1803") that 3,801
 * imported records printed.
 *
 * Those records have no taxon_id: TaiRON published a family, a genus or a
 * class, and the import keeps the name it published in verbatim_name. Display
 * only. Their taxon_id stays null and their blur stays the 10 km of a record
 * nobody has named to the species (0011); this changes words, not records.
 *
 * The name is the published one's first word, the genus or the group, unless
 * its second is lower case, which makes it a binomial: those are the
 * biologist's queue (docs/biologist-queue.md), not this. TaiCOL's accepted row
 * of that name gives the Chinese name and the rank, a row recorded in Taiwan
 * first: 127 of the 137 names on production match exactly one.
 */

/** The columns `higherRankJoin` adds, as the queries below name them. */
export type HigherRank = {
  higherZh: string | null;
  higherRank: string | null;
  higherName: string | null;
};

/**
 * `left join lateral … hr`, on a record aliased `rp`: TaiCOL's row for the
 * group an unnamed record was published under, or nothing. Reads taxa, which
 * web_anon may.
 */
export function higherRankJoin(tx: postgres.Sql | postgres.TransactionSql) {
  return tx`
    left join lateral (
      select t.common_name_zh as higher_zh, t.rank as higher_rank, t.scientific_name as higher_name
        from taxa t
       where rp.taxon_id is null
         and rp.verbatim_name is not null
         and split_part(rp.verbatim_name, ' ', 2) !~ '^[a-z]'
         and lower(t.scientific_name) = lower(split_part(rp.verbatim_name, ' ', 1))
         and t.taxon_status is not distinct from 'accepted'
       order by t.is_in_taiwan desc, (t.common_name_zh is null), t.id
       limit 1
    ) hr on true`;
}

/** The ranks a rank word is written for (messages: detail.rank.*). */
export const RANK_WORDS = [
  "Kingdom", "Phylum", "Class", "Subclass", "Order", "Suborder", "Infraorder",
  "Superfamily", "Family", "Subfamily", "Tribe", "Genus",
] as const;

type T = (key: string, values?: Record<string, string>) => string;

/**
 * 「赤蛙科 Ranidae（只辨識到科）」, "Ranidae (identified to family only)", or null
 * when the record's name matched nothing. English pages print the Latin name:
 * TaiCOL has no English names for groups above the species. `ns` is "" for a
 * translator already scoped to the detail messages.
 */
export function higherRankLabel(t: T, locale: string, hr: HigherRank, ns: "detail." | "" = "detail."): string | null {
  if (!hr.higherName) return null;
  const zh = locale.startsWith("zh");
  const name = zh && hr.higherZh ? `${hr.higherZh} ${hr.higherName}` : hr.higherName;
  const rank = (RANK_WORDS as readonly string[]).includes(hr.higherRank ?? "") ? hr.higherRank : null;
  return rank
    ? t(`${ns}higherRank`, { name, rank: t(`${ns}rank.${rank}`) })
    : t(`${ns}higherRankPlain`, { name });
}
