import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { sql } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { CATEGORIES, type Category } from "@conservation/shared";
import { categoryCounts, topSpecies } from "@/lib/stats";
import { speciesSlug } from "@/lib/species";
import HeatmapView from "@/components/map/HeatmapView";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import Mark from "@/components/brand/Mark";

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site" });
  return { title: { absolute: t("title") }, description: t("description") };
}

type Stats = {
  reports: string;
  species: string;
  obscured: string;
  earliest: string | null;
  latest: string | null;
};

async function getStats(): Promise<Stats> {
  const [row] = await sql<Stats[]>`
    select count(*)::text                                as reports,
           count(distinct taxon_id)::text                as species,
           count(*) filter (where is_obscured)::text     as obscured,
           to_char(min(observed_at), 'YYYY')             as earliest,
           to_char(max(observed_at), 'YYYY')             as latest
      from reports_public`;
  return row;
}

/**
 * The organisation's front door.
 *
 * The map is still the centre of gravity — it is the hero, live and interactive,
 * not a screenshot — but this page has to do the job a bare map could not: say
 * who this is, why roadkill is worth a database, and how someone helps. The
 * full-screen instrument moved to /map, reachable from the hero and the nav.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("home");
  const [s, cats, species] = await Promise.all([
    getStats(),
    categoryCounts(),
    topSpecies(8),
  ]);
  const n = (v: string | number) => Number(v).toLocaleString(locale);
  const byCategory = new Map<Category, number>(
    cats.map((c) => [c.category, c.n]),
  );
  const speciesMax = species[0]?.reportCount ?? 1;
  const years =
    s.earliest && s.latest ? Number(s.latest) - Number(s.earliest) + 1 : null;

  return (
    <main className="bg-bark-950">
      <SiteHeader />

      {/* ---------------- hero ---------------- */}
      <section className="relative h-[92vh] min-h-[560px] w-full overflow-hidden">
        {/* The live map, not an image of one. Someone landing here is already
            looking at the real thing. */}
        <div className="absolute inset-0">
          <HeatmapView
            // Presentation mode frames the island itself against the viewport
            // (see frameIsland), so there is no fixed centre to pass here.
            presentation
            maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined}
            years={
              s.earliest && s.latest
                ? { first: Number(s.earliest), last: Number(s.latest) }
                : null
            }
          />
        </div>

        {/* Scrim: the headline has to stay legible over whatever the map is
            showing, and the map has to stay visibly alive underneath — a flat
            overlay would kill it. Which direction the gradient runs depends on
            where the island is: beside the headline on a wide screen, so it
            falls off to the right; behind it on a phone, so it falls downward. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-bark-950 via-bark-950/80 to-transparent lg:bg-gradient-to-r lg:via-bark-950/85 lg:to-bark-950/10" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bark-950 to-transparent" />

        {/* Top-aligned while the island occupies the lower part of the frame;
            vertically centred once it moves off to the side. `lg` is where
            frameIsland switches arrangements — the two must agree. */}
        <div className="pointer-events-none absolute inset-0 flex items-start pt-32 lg:items-center lg:pt-0">
          <div className="mx-auto w-full max-w-6xl px-6 sm:px-8">
            <div className="max-w-xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-ember-400">
                {t("eyebrow")}
              </p>
              <h1 className="mt-4 text-4xl font-semibold leading-[1.15] text-parchment-50 sm:text-5xl">
                {t("headline")}
              </h1>
              <p className="mt-5 max-w-lg text-sm leading-relaxed text-parchment-200 sm:text-base">
                {t("sub")}
              </p>

              <div className="pointer-events-auto mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/report"
                  className="rounded-full bg-ember-500 px-6 py-3 text-sm font-semibold text-bark-950 transition hover:bg-ember-400"
                >
                  {t("ctaReport")}
                </Link>
                <Link
                  href="/map"
                  className="rounded-full border border-parchment-200/25 px-6 py-3 text-sm font-medium text-parchment-100 transition hover:border-parchment-200/50 hover:bg-parchment-50/5"
                >
                  {t("ctaMap")} →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- the numbers ---------------- */}
      <section className="border-y border-parchment-200/10 bg-bark-900">
        <dl className="mx-auto grid max-w-5xl grid-cols-1 divide-y divide-parchment-200/10 px-6 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            { v: n(s.reports), k: t("statsRecords") },
            { v: n(s.species), k: t("statsSpecies") },
            { v: years ? String(years) : "—", k: t("statsYears") },
          ].map((x) => (
            <div key={x.k} className="px-2 py-8 text-center">
              <dt className="sr-only">{x.k}</dt>
              <dd>
                <span className="block text-4xl font-semibold tabular-nums text-parchment-50">
                  {x.v}
                </span>
                <span className="mt-1 block text-xs text-parchment-400">
                  {x.k}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------------- what we record ---------------- */}
      <Section
        eyebrow={t("whyTitle")}
        title={t("whyHeading")}
        lede={t("whyLede")}
      >
        <div className="grid gap-5 sm:grid-cols-3">
          {[
            {
              c: "roadkill" as const,
              h: t("whyRoadkill"),
              b: t("whyRoadkillBody"),
              n: byCategory.get("roadkill") ?? 0,
            },
            {
              c: "invasive" as const,
              h: t("whyInvasive"),
              b: t("whyInvasiveBody"),
              n: byCategory.get("invasive") ?? 0,
            },
            {
              // One card covers both environmental categories, so it sums them.
              c: "pollution" as const,
              h: t("whyHabitat"),
              b: t("whyHabitatBody"),
              n:
                (byCategory.get("pollution") ?? 0) +
                (byCategory.get("habitat") ?? 0),
            },
          ].map((x) => (
            <article
              key={x.c}
              className="flex flex-col rounded-xl border border-parchment-200/10 bg-bark-900 p-6"
            >
              <span
                aria-hidden
                className="block size-2.5 rounded-full"
                style={{ background: CATEGORIES[x.c].color }}
              />
              <h3 className="mt-4 text-base font-semibold text-parchment-50">
                {x.h}
              </h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-parchment-300">
                {x.b}
              </p>
              {/* The count turns each card from a claim into evidence — but
                  only when there is one. The seed corpus is entirely roadkill,
                  and printing "0 records" under the other two would advertise
                  an empty site rather than a young one. */}
              {x.n > 0 && (
                <p className="mt-5 border-t border-parchment-200/10 pt-3 text-xs tabular-nums text-parchment-400">
                  <span className="font-semibold text-parchment-100">
                    {n(x.n)}
                  </span>{" "}
                  {t("statsRecords")}
                </p>
              )}
            </article>
          ))}
        </div>
      </Section>

      {/* ---------------- who is being hit ---------------- */}
      {species.length > 0 && (
        <Section
          eyebrow={t("speciesTitle")}
          title={t("speciesHeading")}
          lede={t("speciesLede")}
          tone="raised"
        >
          <ol className="grid gap-x-10 gap-y-1 sm:grid-cols-2">
            {species.map((sp, i) => (
              <li key={sp.id}>
                <Link
                  href={`/species/${speciesSlug(sp)}`}
                  className="group flex items-baseline gap-3 rounded-lg px-3 py-2.5 -mx-3 transition hover:bg-parchment-50/5"
                >
                  <span className="w-4 shrink-0 text-xs tabular-nums text-parchment-500">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="truncate text-sm font-medium text-parchment-50 group-hover:text-ember-400">
                        {sp.commonNameZh ?? sp.scientificName}
                      </span>
                      {sp.commonNameZh && (
                        <span className="truncate text-[11px] italic text-parchment-500">
                          {sp.scientificName}
                        </span>
                      )}
                    </span>
                    {/* A bar makes the long tail legible at a glance: the top
                        species has many times the records of the eighth. */}
                    <span
                      aria-hidden
                      className="mt-1.5 block h-1 overflow-hidden rounded-full bg-parchment-50/5"
                    >
                      <span
                        className="block h-full rounded-full bg-moss-400/70"
                        style={{
                          width: `${Math.max(2, (sp.reportCount / speciesMax) * 100)}%`,
                        }}
                      />
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-parchment-400">
                    {n(sp.reportCount)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <Link
            href="/species"
            className="mt-8 inline-block text-sm text-ember-400 transition hover:text-ember-300"
          >
            {t("speciesLink")} →
          </Link>
        </Section>
      )}

      {/* ---------------- how it works ---------------- */}
      <Section eyebrow={t("howTitle")} title={t("howHeading")}>
        {/* The rule runs behind the numbered markers and stops short of the
            last one, so the three steps read as one sequence rather than three
            unrelated columns. Hidden on mobile, where they stack. */}
        <div className="relative">
          <div
            aria-hidden
            className="absolute left-0 right-0 top-4 hidden h-px bg-gradient-to-r from-ember-500/30 via-ember-500/20 to-transparent sm:block"
          />
          <ol className="relative grid gap-8 sm:grid-cols-3 sm:gap-10">
            {[
              { h: t("how1"), b: t("how1Body") },
              { h: t("how2"), b: t("how2Body") },
              { h: t("how3"), b: t("how3Body") },
            ].map((x, i) => (
              <li key={x.h}>
                <span className="flex size-8 items-center justify-center rounded-full border border-ember-500/40 bg-bark-950 text-xs font-semibold text-ember-400">
                  {i + 1}
                </span>
                <h3 className="mt-5 text-base font-semibold text-parchment-50">
                  {x.h}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-parchment-300">
                  {x.b}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* ---------------- trust ---------------- */}
      <Section tone="raised">
        <div className="grid gap-5 sm:grid-cols-2">
          {[
            {
              h: t("trustTitle"),
              b: t("trustBody"),
              href: "/about" as const,
              link: t("trustLink"),
            },
            {
              h: t("openTitle"),
              b: t("openBody"),
              href: "/attribution" as const,
              link: t("openLink"),
            },
          ].map((x) => (
            <div
              key={x.h}
              className="flex flex-col rounded-xl border border-parchment-200/10 bg-bark-950/60 p-7"
            >
              <h2 className="text-lg font-semibold text-parchment-50">{x.h}</h2>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-parchment-300">
                {x.b}
              </p>
              <Link
                href={x.href}
                className="mt-5 text-sm text-ember-400 transition hover:text-ember-300"
              >
                {x.link} →
              </Link>
            </div>
          ))}
        </div>
      </Section>

      {/* ---------------- closing call ---------------- */}
      <section className="border-t border-parchment-200/10 bg-bark-900">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-6 py-20 text-center">
          <Mark className="size-14" />
          <h2 className="max-w-lg text-2xl font-semibold leading-snug text-parchment-50">
            {t("finalTitle")}
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-parchment-300">
            {t("finalBody")}
          </p>
          <Link
            href="/report"
            className="rounded-full bg-ember-500 px-7 py-3 text-sm font-semibold text-bark-950 transition hover:bg-ember-400"
          >
            {t("ctaReport")}
          </Link>
        </div>
      </section>

      <SiteFooter
        obscured={Number(s.obscured) > 0 ? n(s.obscured) : undefined}
      />
    </main>
  );
}

/**
 * One section rhythm for the whole page.
 *
 * The eyebrow alone was doing the work of a heading before, in 12px tracked-out
 * grey — so every band looked the same weight and the page read as one
 * undifferentiated column of small text. The eyebrow now labels, the heading
 * carries, and the lede says the one thing worth reading if you read nothing
 * else. Alternating `tone` gives the scroll a beat.
 */
function Section({
  eyebrow,
  title,
  lede,
  tone = "flat",
  children,
}: {
  eyebrow?: string;
  title?: string;
  lede?: string;
  tone?: "flat" | "raised";
  children: React.ReactNode;
}) {
  return (
    <section
      className={
        tone === "raised"
          ? "border-y border-parchment-200/10 bg-bark-900/40"
          : undefined
      }
    >
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        {(eyebrow || title) && (
          <div className="mb-10 max-w-2xl">
            {eyebrow && (
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-ember-400/80">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="mt-3 text-2xl font-semibold leading-snug text-parchment-50 sm:text-3xl">
                {title}
              </h2>
            )}
            {lede && (
              <p className="mt-4 text-sm leading-relaxed text-parchment-300 sm:text-base">
                {lede}
              </p>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
