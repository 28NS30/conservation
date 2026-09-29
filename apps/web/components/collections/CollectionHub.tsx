import Image from "next/image";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  CATEGORIES,
  filterToQuery,
  type Collection,
} from "@conservation/shared";
import {
  collectionSummary,
  invasiveSpeciesList,
  newestRecords,
} from "@/lib/collections";
import { speciesSlug } from "@/lib/species";
import { PHOTOS, type PhotoKey } from "@/lib/home/photos";
import { SectionTitle } from "@/components/home/StoryRow";
import InvasiveBadge from "@/components/collections/InvasiveBadge";
import InvasiveSpeciesList from "@/components/collections/InvasiveSpeciesList";
import { alternates } from "@/lib/alternates";
import SpeciesName from "@/components/species/SpeciesName";

/**
 * One page per collection: /roadkill, /invasive and /wildlife.
 *
 * The team asked for three databases. They are three filters over one table
 * (see COLLECTIONS in packages/shared), and these pages are where each is
 * visible as a thing of its own: what it holds, how much, the newest records,
 * a way onto the map with only it showing, and a way to add to it.
 *
 * In the team's design, the home page's idiom: a forest band with a statement
 * beside a photograph, then ivory sections opened by a centred title and a
 * short orange rule. Every number on it is read live from the public view, and
 * every date is stated rather than implied — on today's data the newest record
 * is from 2017, and a page that called that "recent" would be the one thing a
 * reader remembered about it.
 *
 * Each page links to the matching report page, /report/<kind>. Those pages
 * are built separately; the slugs are the plan's.
 */

/** The photograph beside each collection's statement, from the home page's set. */
const PHOTO: Record<Collection, PhotoKey> = {
  roadkill: "forestRoad",
  invasive: "iguana",
  wildlife: "treeFrog",
};

/** Which report page adds to each collection. */
export const REPORT_PAGE: Record<Collection, string> = {
  roadkill: "/report/roadkill",
  invasive: "/report/invasive",
  wildlife: "/report/wildlife",
};

export async function collectionMetadata(
  params: Promise<{ locale: string }>,
  collection: Collection,
): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "collections" });
  return {
    title: t(`name.${collection}`),
    description: t(`${collection}.lede`),
    alternates: alternates(locale, `/${collection}`),
  };
}

export default async function CollectionHub({
  params,
  collection,
}: {
  params: Promise<{ locale: string }>;
  collection: Collection;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("collections");
  const tc = await getTranslations("categories");
  const tp = await getTranslations("precision");
  const td = await getTranslations("detail");
  const tHome = await getTranslations("home");
  const zh = locale.startsWith("zh");

  const [summary, newest, species] = await Promise.all([
    collectionSummary(collection),
    newestRecords(collection, 8),
    collection === "invasive" ? invasiveSpeciesList() : Promise.resolve([]),
  ]);

  const n = (v: number) => v.toLocaleString(locale);
  const day = (d: Date | string) =>
    new Date(d).toLocaleDateString(locale, {
      timeZone: "Asia/Taipei",
      dateStyle: "medium",
    });
  const photo = PHOTOS[PHOTO[collection]];
  const name = t(`name.${collection}`);
  const empty = summary.records === 0;
  const q = filterToQuery({ collection });
  const mapHref = `/map?${q}`;
  const listHref = `/reports?${q}`;
  const years =
    summary.firstYear && summary.lastYear
      ? summary.firstYear === summary.lastYear
        ? String(summary.firstYear)
        : `${summary.firstYear}–${summary.lastYear}`
      : null;

  const stats: { key: string; label: string; value: string }[] = [
    { key: "records", label: t("hub.records"), value: n(summary.records) },
    { key: "species", label: t("hub.species"), value: n(summary.species) },
    ...(years ? [{ key: "years", label: t("hub.years"), value: years }] : []),
  ];

  return (
    <main className="bg-paper-50">
      {/* ---------------- statement ---------------- */}
      <section
        aria-labelledby="collection-title"
        className="bg-forest-900 text-paper-50"
      >
        <div className="mx-auto grid max-w-[1280px] lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-12 lg:px-6 lg:py-12">
          <div className="order-2 flex flex-col justify-center px-5 pb-12 pt-8 sm:px-8 lg:order-1 lg:px-0 lg:py-4">
            <span aria-hidden className="block h-1.5 w-20 bg-ember-500" />
            <p className="mt-6 font-display text-[15px] font-semibold uppercase tracking-[0.14em] text-parchment-200">
              {t("hub.kicker")}
            </p>
            <h1
              id="collection-title"
              className={`mt-3 font-display text-[clamp(2.5rem,9vw,4rem)] font-bold leading-[0.98] text-paper-50 [text-wrap:balance] ${
                zh ? "tracking-[0.04em]" : "uppercase"
              }`}
            >
              {name}
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-paper-50/90 sm:text-lg">
              {t(`${collection}.lede`)}
            </p>

            {empty ? (
              <p className="mt-8 max-w-xl border-l-4 border-ember-500 pl-4 text-[17px] leading-relaxed text-paper-50">
                {t(`${collection}.empty`)}
              </p>
            ) : (
              <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
                {stats.map((s) => (
                  <div key={s.key}>
                    <dt className="text-[14px] text-parchment-200">{s.label}</dt>
                    <dd className="mt-1 font-display text-[32px] font-bold leading-none tabular-nums text-paper-50">
                      {s.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="mt-8 flex flex-wrap gap-3">
              {/* Dark text on the orange: 6.1:1, where white is 3.4:1.
                  Not prefetched. The report pages are built in another
                  stream and may land after this one, and a prefetch of a page
                  that is not there yet is a 404 on every visit; a report is
                  also something a reader sets out to file, not a page to
                  warm on the way past. */}
              <Link
                href={REPORT_PAGE[collection]}
                prefetch={false}
                className="inline-flex min-h-12 items-center bg-ember-500 px-6 font-display text-[18px] font-bold uppercase tracking-[0.06em] text-ink-950 transition hover:bg-ember-400"
              >
                {t(`hub.file.${collection}`)}
              </Link>
              {/* Not offered over an empty collection: a map with nothing on
                  it reads as a broken map, not as an empty collection. */}
              {!empty && (
                <Link
                  href={mapHref}
                  className="inline-flex min-h-12 items-center gap-2 border-2 border-paper-50/70 px-6 font-display text-[18px] font-semibold uppercase tracking-[0.06em] text-paper-50 transition hover:border-paper-50 hover:bg-paper-50/10"
                >
                  {t("hub.viewOnMap")}
                  <span aria-hidden>→</span>
                </Link>
              )}
            </div>
          </div>

          <figure className="order-1 lg:order-2 lg:self-center">
            <div className="relative aspect-[3/2] w-full overflow-hidden bg-forest-950">
              <Image
                src={photo.src}
                alt={zh ? photo.alt.zh : photo.alt.en}
                fill
                priority
                sizes="(min-width: 1280px) 520px, (min-width: 1024px) 42vw, 100vw"
                className="object-cover"
              />
            </div>
            {/* The credit its licence requires, as on the home page. */}
            <figcaption className="px-5 pt-2 text-[14px] leading-snug text-parchment-300 sm:px-8 lg:px-0">
              {zh ? photo.name.zh : photo.name.en}
              {" · "}
              {tHome("photoBy")}{" "}
              <a
                href={photo.source}
                target="_blank"
                rel="noopener noreferrer"
                className="whitespace-nowrap underline underline-offset-2 hover:text-paper-50"
              >
                {photo.author}
              </a>
              {" · "}
              <a
                href={photo.licenseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="whitespace-nowrap underline underline-offset-2 hover:text-paper-50"
              >
                {photo.license}
              </a>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ---------------- what it holds ---------------- */}
      <section
        aria-labelledby="holds-title"
        className="px-5 py-14 sm:px-8 sm:py-20"
      >
        <SectionTitle id="holds-title" title={t("hub.holdsTitle")} zh={zh} />
        <div className="mx-auto mt-10 grid max-w-[1100px] gap-8 md:grid-cols-3 md:gap-10">
          {(
            [
              ["holds", t(`${collection}.holds`)],
              ["overlap", t(`${collection}.overlap`)],
              ["blur", t("hub.blur")],
            ] as const
          ).map(([k, body]) => (
            <div key={k}>
              <h3
                className={`font-display text-[22px] font-bold leading-tight text-forest-900 ${
                  zh ? "tracking-[0.04em]" : "uppercase tracking-[0.01em]"
                }`}
              >
                {t(`hub.${k}Heading`)}
              </h3>
              <p className="mt-3 text-[16px] leading-relaxed text-ink-950">{body}</p>
            </div>
          ))}
        </div>

        {/* The one collection holding the living and the dead, split. */}
        {collection === "invasive" && !empty && (
          <div className="mx-auto mt-12 max-w-[1100px] border-t-2 border-forest-900/15 pt-8">
            <h3
              className={`font-display text-[22px] font-bold text-forest-900 ${
                zh ? "tracking-[0.04em]" : "uppercase tracking-[0.01em]"
              }`}
            >
              {t("conditionLabel")}
            </h3>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["alive", summary.alive],
                  ["dead", summary.dead],
                ] as const
              ).map(([c, count]) => {
                const inner = (
                  <>
                    <span className="text-[16px] font-semibold text-forest-900">
                      {t(`condition.${c}`)}
                    </span>
                    <span className="text-[16px] tabular-nums text-ink-950">
                      {t("hub.recordCount", { count })}
                      {count > 0 && (
                        <span aria-hidden className="ml-2 text-leaf-700">→</span>
                      )}
                    </span>
                  </>
                );
                const box =
                  "flex min-h-12 items-center justify-between gap-4 border-2 px-4 py-3";
                return (
                  <li key={c}>
                    {/* A count of nothing is said, not linked: a link to an
                        empty list is a tap that finds out what the zero
                        already said. */}
                    {count > 0 ? (
                      <Link
                        href={`/reports?${filterToQuery({ collection, condition: c })}`}
                        className={`${box} border-forest-900/20 bg-paper-100 transition hover:border-forest-900`}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className={`${box} border-dashed border-forest-900/20`}>
                        {inner}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {/* ---------------- newest records ---------------- */}
      {!empty && (
        <section
          aria-labelledby="newest-title"
          className="bg-paper-100 px-5 py-14 sm:px-8 sm:py-20"
        >
          <SectionTitle
            id="newest-title"
            title={t("hub.newestTitle")}
            hint={
              summary.newest && years
                ? t("hub.newestHint", {
                    date: day(summary.newest),
                    years,
                  })
                : undefined
            }
            zh={zh}
          />
          <ol className="mx-auto mt-10 max-w-[900px] divide-y divide-ink-900/10 border-y border-ink-900/10">
            {newest.map((r) => {
              const named = r.taxonId && r.scientificName;
              return (
                <li key={r.id}>
                  <Link
                    href={`/reports/${r.id}`}
                    className="group grid min-h-12 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 py-3 transition hover:bg-paper-200/60 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
                  >
                    <span className="text-[14px] tabular-nums text-ink-700 underline underline-offset-2 group-hover:text-forest-900">
                      {day(r.observedAt)}
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[16px] font-semibold text-ink-950">
                        {named ? (
                          <SpeciesName
                            species={{ ...r, scientificName: r.scientificName! }}
                            locale={locale}
                            layout="primary"
                          />
                        ) : (
                          td("notYetIdentified")
                        )}
                      </span>
                      {/* On the invasive page every record is invasive, so the
                          mark would repeat down the list and say nothing;
                          only a record nobody has named still needs its
                          "reported as invasive". Elsewhere it is the point. */}
                      {r.isInvasive && (collection !== "invasive" || !r.taxonId) && (
                        <InvasiveBadge
                          label={t(r.taxonId ? "badge.invasive" : "badge.reported")}
                          title={t(r.taxonId ? "badge.invasiveWhy" : "badge.reportedWhy")}
                        />
                      )}
                    </span>
                    <span className="col-start-2 flex items-center gap-2 text-[14px] text-ink-600 sm:col-start-3 sm:justify-end">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: CATEGORIES[r.category].color }}
                      />
                      {tc(r.category)}
                      {r.isObscured && (
                        <span className="text-ink-600" title={tp(r.locationPrecision)}>
                          {"· ≈ "}
                          <span className="sr-only">{tp(r.locationPrecision)}</span>
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>

          <div className="mx-auto mt-6 flex max-w-[900px] flex-col gap-2 text-[14px] text-ink-700 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href={listHref}
              className="inline-flex min-h-11 items-center gap-1 font-semibold text-leaf-700 underline underline-offset-2 hover:text-forest-900"
            >
              {t("hub.seeAll", { count: summary.records })}
              <span aria-hidden>→</span>
            </Link>
            {/* Where the records came from, counted rather than asserted: the
                day this site's own reports arrive, this line changes by itself. */}
            <p>
              {t("hub.sources", {
                imported: summary.imported,
                filed: summary.filed,
              })}
            </p>
          </div>
        </section>
      )}

      {/* ---------------- the species list (invasive only) ---------------- */}
      {collection === "invasive" && (
        <section
          id="species"
          aria-labelledby="species-title"
          className="scroll-mt-28 px-5 py-14 sm:px-8 sm:py-20"
        >
          <SectionTitle
            id="species-title"
            title={t("invasive.listTitle")}
            hint={t("invasive.listHint", { count: species.length })}
            zh={zh}
          />
          <p className="mx-auto mt-8 max-w-2xl text-[16px] leading-relaxed text-ink-950">
            {t("invasive.catsDogs")}
          </p>
          <InvasiveSpeciesList
            zh={zh}
            species={species.map((s) => ({
              id: s.id,
              slug: speciesSlug(s),
              scientificName: s.scientificName,
              commonNameZh: s.commonNameZh,
              altNamesZh: s.altNamesZh,
              commonNameEn: s.commonNameEn,
              altNamesEn: s.altNamesEn,
              taicolId: s.taicolId,
              class: s.class,
              protectedStatus: s.protectedStatus,
              reportCount: s.reportCount,
              note: s.note,
            }))}
          />
        </section>
      )}
    </main>
  );
}
