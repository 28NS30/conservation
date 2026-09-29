import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import PageHeader from "@/components/site/PageHeader";
import { Link } from "@/i18n/navigation";
import { asPublic } from "@/lib/db";
import {
  CATEGORIES,
  COLLECTION_KEYS,
  RECORD_CONDITION_KEYS,
  filterToQuery,
  pageFilter,
  selectionFor,
  type Category,
  type Collection,
  type LocationPrecision,
} from "@conservation/shared";
import InvasiveBadge from "@/components/collections/InvasiveBadge";
import { publicSpeciesName, speciesSlug } from "@/lib/species";
import { signedPhotoUrls } from "@/lib/supabase/service";
import { sql } from "@/lib/db";
import Pager from "@/components/site/Pager";
import { alternates } from "@/lib/alternates";
import SpeciesName from "@/components/species/SpeciesName";
import { speciesLabel } from "@/lib/speciesNames";

export const revalidate = 120;

const PAGE_SIZE = 50;

type Row = {
  id: string;
  category: Category;
  observedAt: string;
  lat: number;
  lng: number;
  locationPrecision: LocationPrecision;
  isObscured: boolean;
  taxonId: number | null;
  scientificName: string | null;
  commonNameZh: string | null;
  commonNameEn: string | null;
  taicolId: string | null;
  isInvasive: boolean;
};

/** The swatch beside a collection's chip, as on the map's toggles. */
const COLLECTION_SWATCH: Record<Collection, string> = {
  roadkill: CATEGORIES.roadkill.color,
  invasive: CATEGORIES.invasive.color,
  wildlife: CATEGORIES.sighting.color,
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "list" });
  return { title: t("title"), description: t("subtitle"), alternates: alternates(locale, "/reports") };
}

/**
 * Text alternative to the map.
 *
 * A WebGL canvas is unusable with a screen reader, so the same data needs a
 * non-map representation. This is also simply useful — it is the fastest way to
 * see every record, newest first, and it works with no JavaScript at all.
 *
 * It used to introduce itself as "Recent reports", above a first row dated
 * 2017-12-31: every record is from the imported 2011–2017 dataset. So the lede
 * now says what the records are — how many, and the years they span — read from
 * the same public view the table is, which keeps it true the day the first
 * report of this year arrives.
 */
export default async function ReportsListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const rawPage = typeof sp.page === "string" ? sp.page : undefined;
  // Parsed with the same schema the map and the tile endpoint use, so the whole
  // filter survives the jump from the map. This page is the accessibility
  // fallback for a canvas nobody can read with a screen reader; if it silently
  // dropped the species and date filters it would not actually be an equivalent.
  // An old `group=` link is read as the collection it meant (pageFilter).
  const f = pageFilter(sp);
  const taxonId = f.taxonId ?? null;
  const from = f.from ?? null;
  const to = f.to ?? null;

  const t = await getTranslations("list");
  const tc = await getTranslations("categories");
  // The chips are the three collections, in the words the map's toggles use.
  const tcol = await getTranslations("collections");
  const tp = await getTranslations("precision");
  // The map already has a word for this and the two controls do the same thing.
  const tm = await getTranslations("map");

  // The filter jumps here from the map, so it has to be the same collections
  // the map offers, read by the same selectionFor() the tiles use — this page
  // is that map's accessible equivalent, and an equivalent that filtered
  // differently would not be one.
  const collection = f.collection ?? null;
  const condition = f.condition ?? null;
  const { categories, invasiveOnly } = selectionFor(f);
  // A whole page number within reach: 1.5 and 1e300 reached OFFSET and 500'd.
  // 2,000 pages of 50 is every record there is, many times over.
  const page = Math.min(2000, Math.max(1, Math.floor(Number(rawPage)) || 1));
  const offset = (page - 1) * PAGE_SIZE;

  const rows = await asPublic(
    (tx) => tx<Row[]>`
      select rp.id, rp.category, rp.observed_at as "observedAt",
             st_y(rp.location_public::geometry) as lat,
             st_x(rp.location_public::geometry) as lng,
             rp.location_precision as "locationPrecision",
             rp.is_obscured as "isObscured",
             rp.taxon_id as "taxonId",
             t.scientific_name as "scientificName",
             t.common_name_zh as "commonNameZh",
             t.common_name_en as "commonNameEn",
             t.taicol_id as "taicolId",
             rp.is_invasive as "isInvasive"
        from reports_public rp
        left join taxa t on t.id = rp.taxon_id
       where (${categories}::text[] is null or rp.category = any(${categories}))
         and (not ${invasiveOnly}::boolean or rp.is_invasive)
         and (${taxonId}::bigint is null or rp.taxon_id = ${taxonId})
         and (${from}::date is null or rp.observed_at >= (${from}::date::timestamp at time zone 'Asia/Taipei'))
         and (${to}::date   is null or rp.observed_at <  ((${to}::date + 1)::timestamp at time zone 'Asia/Taipei'))
       -- rp.id makes the order total. The import ends on 2017-12-31 and many
       -- records share a date, and rows that tie come back in whatever order
       -- the plan produces: page 1 showed different records on each load, and
       -- a record could fall between two pages and never be shown at all.
       order by rp.observed_at desc, rp.id
       limit ${PAGE_SIZE + 1} offset ${offset}`,
  );

  const hasNext = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);

  // The whole public set, not the filtered page: the lede describes what this
  // list is, and the "Filtered by" line below describes what is in view.
  const [span] = await asPublic(
    (tx) => tx<{ n: number; from: number | null; to: number | null }[]>`
      select count(*)::int as n,
             extract(year from min(observed_at) at time zone 'Asia/Taipei')::int as "from",
             extract(year from max(observed_at) at time zone 'Asia/Taipei')::int as "to"
        from reports_public`,
  );
  const lede =
    span && span.n > 0 && span.from && span.to
      ? `${t("subtitle")} ${t("span", {
          count: span.n,
          from: String(span.from),
          to: String(span.to),
        })}`
      : t("subtitle");

  /*
   * One thumbnail per row.
   *
   * Every row here is someone who stopped at a roadside and photographed a dead
   * animal. As a table of dates and coordinates that reads as a database export;
   * with the photographs it reads as evidence, which is what it is — and this is
   * the page most likely to convince a stranger the project is real.
   *
   * Safe to read paths with the privileged connection: `visible` came from
   * reports_public, so every row here is already publicly visible, and the
   * photos carry no location — EXIF is stripped in the browser before upload.
   */
  const firstPhotos = visible.length
    ? await sql<{ report_id: string; storage_path: string }[]>`
        select distinct on (report_id) report_id::text, storage_path
          from report_photos
         where report_id = any(${visible.map((r) => r.id)}::uuid[])
         order by report_id, created_at`
    : [];
  const signed = await signedPhotoUrls(
    firstPhotos.map((p) => p.storage_path),
    900,
  );
  const thumb = new Map(
    firstPhotos
      .map((p) => [p.report_id, signed.get(p.storage_path)] as const)
      .filter((e): e is readonly [string, string] => !!e[1]),
  );

  /*
   * The column only exists when something is in it.
   *
   * Every seeded record came from GBIF without a photograph — today that is all
   * 46,402 of them — so an unconditional thumbnail column would be a strip of
   * empty placeholders down the whole page, which is worse than the table it
   * replaced. It appears once people start submitting, and until then this page
   * looks exactly as it did.
   *
   * Rows without a photo leave the cell empty rather than drawing a grey square.
   * Once one report has a photograph the column exists for all of them, and
   * 46,402 seeded records have none — a placeholder each would be the same wall
   * of noise by another route.
   */
  const showPhotos = thumb.size > 0;

  /** Carry every active filter through paging and the collection chips. */
  const activeFilter = filterToQuery({
    ...(collection ? { collection } : {}),
    ...(condition ? { condition } : {}),
    ...(taxonId ? { taxonId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const withFilter = (extra: Record<string, string>) => {
    const p = new URLSearchParams(activeFilter);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/reports?${p}`;
  };
  /**
   * The list with a different collection (or none) and the species and dates
   * kept. Built through filterToQuery so the keys come out in the one order the
   * map and the tiles use. The alive/dead split belongs to the invasive
   * collection and does not survive leaving it.
   */
  const withCollection = (c: Collection | null) => {
    const q = filterToQuery({
      ...(c ? { collection: c } : {}),
      ...(c === "invasive" && condition ? { condition } : {}),
      ...(taxonId ? { taxonId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    return q ? `/reports?${q}` : "/reports";
  };
  const withCondition = (c: "alive" | "dead" | null) => {
    const q = filterToQuery({
      collection: "invasive",
      ...(c ? { condition: c } : {}),
      ...(taxonId ? { taxonId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    return `/reports?${q}`;
  };
  const qs = (p: number) => withFilter({ page: String(p) });
  /**
   * Back to the map, carrying the filter and nothing else.
   *
   * Not `page`: a page number is a fact about a 50-row table and means nothing
   * to a map, and carrying it would produce links that differ without differing.
   * The map answers the same question this page does, and until now the trip was
   * one way — the map offers the list, the list offered no way back, so
   * switching cost a visitor their filters.
   */
  const mapHref = activeFilter ? `/map?${activeFilter}` : "/map";

  /*
   * Say which filter is in force.
   *
   * The category chips draw themselves, but a species and a date range arrive
   * from the map through the query string and had nowhere on this page to
   * appear. So a link shared from a filtered map opened a list of forty records
   * of one animal in one year, looking exactly like the most recent forty
   * reports on the site — which is the kind of wrong that gets quoted.
   *
   * The species is named through the public lookup, which joins the stats view:
   * a taxon rated 座標不開放 has no public records, and naming it over an empty
   * list would be the only thing on the page confirming it had been recorded
   * here. When that lookup answers nothing, the line simply omits the name.
   */
  const named = taxonId ? await publicSpeciesName(taxonId) : null;
  const day = (d: string) =>
    new Date(d).toLocaleDateString(locale, { timeZone: "Asia/Taipei" });
  const dates =
    from && to
      ? t("dateRange", { from: day(from), to: day(to) })
      : from
        ? t("dateFrom", { from: day(from) })
        : to
          ? t("dateTo", { to: day(to) })
          : null;
  const speciesName = named ? speciesLabel(named, locale) : null;
  const filterParts = [speciesName, dates].filter(Boolean) as string[];
  /** The same sentence the chips row shows, for the table's caption. */
  const filterCaption = filterParts.length
    ? `${t("tableCaption")} — ${t("filteredBy")}: ${filterParts.join("; ")}`
    : t("tableCaption");

  // Clearing from the filter line keeps the collection chips, which are their
  // own control with their own "All"; clearing from the empty state clears
  // everything, because there is nothing left on screen to clear it from.
  const collectionOnly = filterToQuery({
    ...(collection ? { collection } : {}),
    ...(condition ? { condition } : {}),
  });
  const withoutSpeciesAndDates = collectionOnly
    ? `/reports?${collectionOnly}`
    : "/reports";
  const anyFilter = Boolean(collection || taxonId || from || to);

  const chip = (on: boolean) =>
    `flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm transition ${
      on
        ? "border-forest-900 bg-forest-900 font-medium text-paper-50"
        : "border-ink-900/12 bg-paper-100/70 text-ink-700 hover:bg-paper-200"
    }`;

  return (
    <main className="mx-auto w-full max-w-4xl px-6 pb-24 pt-12">
      <PageHeader title={t("title")} lede={lede} />

      {/* The three collections, as on the map. They overlap: a live invasive
          animal is in wildlife and in invasive, so the counts across the chips
          add up to more than "All". */}
      <nav
        aria-label={tcol("filterLabel")}
        className="mt-4 flex flex-wrap gap-1.5"
      >
        <Link
          href={withCollection(null)}
          aria-current={!collection ? "page" : undefined}
          className={chip(!collection)}
        >
          {t("all")}
        </Link>
        {COLLECTION_KEYS.map((c) => (
          <Link
            key={c}
            href={withCollection(c)}
            aria-current={collection === c ? "page" : undefined}
            className={chip(collection === c)}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: COLLECTION_SWATCH[c] }}
              aria-hidden
            />
            {tcol(`name.${c}`)}
          </Link>
        ))}
      </nav>

      {/* Alive or dead, inside the invasive collection only — the one that
          holds both, since a road-killed myna is still an invasive animal. */}
      {collection === "invasive" && (
        <nav
          aria-label={tcol("conditionLabel")}
          className="mt-2 flex flex-wrap gap-1.5"
        >
          <Link
            href={withCondition(null)}
            aria-current={!condition ? "page" : undefined}
            className={chip(!condition)}
          >
            {tcol("condition.any")}
          </Link>
          {RECORD_CONDITION_KEYS.map((c) => (
            <Link
              key={c}
              href={withCondition(c)}
              aria-current={condition === c ? "page" : undefined}
              className={chip(condition === c)}
            >
              {tcol(`condition.${c}`)}
            </Link>
          ))}
        </nav>
      )}

      {/* What the collection is, one tap away: its own page explains it and
          lists what it holds. */}
      {collection && (
        <p className="mt-3 text-[14px]">
          <Link
            href={`/${collection}`}
            className="inline-flex min-h-11 items-center gap-1 text-leaf-700 underline underline-offset-2 hover:text-forest-900"
          >
            {tcol("aboutCollection", { name: tcol(`name.${collection}`) })}
            <span aria-hidden>→</span>
          </Link>
        </p>
      )}

      {filterParts.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-700">
          <span className="text-ink-600">{t("filteredBy")}</span>
          {named && (
            <Link
              href={`/species/${speciesSlug(named)}`}
              className="text-ink-800 underline underline-offset-2 hover:text-ember-700"
            >
              {speciesName}
            </Link>
          )}
          {dates && <span className="tabular-nums">{dates}</span>}
          <Link
            href={withoutSpeciesAndDates}
            className="inline-flex min-h-11 items-center text-ember-700 hover:underline"
          >
            {tm("clearFilters")}
          </Link>
        </p>
      )}

      {/* Beside the chips but outside that nav, which is labelled as the
          category filter: this is not one of the categories, and announcing it
          inside that list would say it was. Below the filter line rather than
          above it, so the order on the page is what is filtered, then the way
          out of the list — and mapHref carries those same filters across. */}
      <p className="mt-3 text-sm">
        <Link
          href={mapHref}
          className="inline-flex min-h-11 items-center gap-1 font-medium text-leaf-700 underline underline-offset-2 transition hover:text-forest-900"
        >
          {t("viewOnMap")}
          <span aria-hidden>→</span>
        </Link>
      </p>

      {visible.length === 0 ? (
        <div className="mt-8 text-center text-sm text-ink-500">
          <p>{t("empty")}</p>
          {anyFilter && (
            <Link
              href="/reports"
              className="mt-2 inline-flex min-h-11 items-center text-ember-700 transition hover:underline"
            >
              {tm("clearFilters")}
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          {/* Stays 12px: at 14px its English headers make it wider than a
              320px screen, and the page then scrolls sideways despite the
              wrapper (e2e/reflow.spec.mjs). */}
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{filterCaption}</caption>
            <thead className="text-ink-600">
              <tr>
                {showPhotos && (
                  <th scope="col" className="w-14 py-1.5">
                    <span className="sr-only">{t("photo")}</span>
                  </th>
                )}
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  {t("date")}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  {t("category")}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  {t("species")}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  {t("location")}
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-ink-900/10 align-top">
                  {showPhotos && (
                    <td className="py-1.5 pr-3">
                      {thumb.get(r.id) ? (
                        /* eslint-disable-next-line @next/next/no-img-element --
                         a signed Storage URL expires, so next/image's optimiser
                         would cache a URL that stops working. */
                        <img
                          src={thumb.get(r.id)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="size-10 rounded object-cover"
                        />
                      ) : null}
                    </td>
                  )}
                  {/* The only link to the record itself, and it was a
                      body-coloured date 15px tall — nothing marked it as a way
                      in, and nothing a thumb could reliably hit. Underlined,
                      inked darker than the cells around it, and grown to the
                      height of the row so the whole line is a target. */}
                  <td className="whitespace-nowrap py-0">
                    {/* No prefetch: a page of fifty rows prefetched some
                        eighty record and species pages on every view, each
                        rendered on the server, for rows nobody opened. */}
                    <Link
                      href={`/reports/${r.id}`}
                      prefetch={false}
                      className="flex min-h-11 items-center pr-3 text-ink-800 underline underline-offset-2 hover:text-ember-700"
                    >
                      {new Date(r.observedAt).toLocaleDateString(locale, {
                        timeZone: "Asia/Taipei",
                      })}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 text-ink-500">{tc(r.category)}</td>
                  <td className="py-1.5 pr-3">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {r.taxonId && r.scientificName ? (
                        <Link
                          href={`/species/${speciesSlug({ id: r.taxonId, scientificName: r.scientificName })}`}
                          prefetch={false}
                          className="text-ink-700 hover:text-ember-700"
                        >
                          {/* The page's own language only: a table cell on
                              a 320px phone has room for one name. */}
                          <SpeciesName
                            species={{ ...r, scientificName: r.scientificName }}
                            locale={locale}
                            layout="primary"
                          />
                        </Link>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                      {r.isInvasive && (
                        <InvasiveBadge
                          label={tcol(r.taxonId ? "badge.invasive" : "badge.reported")}
                          title={tcol(r.taxonId ? "badge.invasiveWhy" : "badge.reportedWhy")}
                        />
                      )}
                    </span>
                  </td>
                  <td className="py-1.5 tabular-nums text-ink-500">
                    {r.lat.toFixed(3)}, {r.lng.toFixed(3)}
                    {r.isObscured && (
                      <span
                        className="ml-1.5 text-amber-700"
                        title={tp(r.locationPrecision)}
                      >
                        ≈
                        <span className="sr-only">
                          {" "}
                          {tp(r.locationPrecision)}
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The ≈ already carries a title and an sr-only label, so a screen reader
          hears what it means — but a sighted user who does not hover just sees an
          unexplained symbol, on the page whose entire job is being the readable
          version of the map. Shown only when a row on this page actually is
          obscured, so it never explains a mark that is not there. */}
      {visible.some((r) => r.isObscured) && (
        <p className="mt-3 text-sm leading-relaxed text-ink-700">
          <span className="text-amber-700">≈</span> {t("obscuredLegend")}
        </p>
      )}

      <Pager
        page={page}
        hasPrev={page > 1}
        hasNext={hasNext}
        hrefFor={qs}
      />
    </main>
  );
}
