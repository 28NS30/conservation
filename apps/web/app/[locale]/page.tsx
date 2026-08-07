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
import Badge from "@/components/brand/Badge";

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
    <main className="bg-paper-50">
      <SiteHeader />

      {/* ---------------- hero ---------------- */}
      {/*
        The map is the stage, not an illustration beside the words.

        It ran as a column next to a block of prose, which made it one element
        among several and left the page reading like a brochure about a map. Full
        bleed, the instrument is the first and largest thing on screen and the
        panel is clearly laid over something live.

        The panel carries the whole entry point — badge, name, and every route
        out — so the top bar can stay out of the way. Buttons are stacked and
        full width rather than a row of pills: one column of equal-weight targets
        reads as a menu, and works identically on a phone.
      */}
      <section className="relative h-[100dvh] min-h-[600px] w-full overflow-hidden bg-bark-950">
        <div className="absolute inset-0">
          <HeatmapView
            presentation
            maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined}
            years={
              s.earliest && s.latest
                ? { first: Number(s.earliest), last: Number(s.latest) }
                : null
            }
          />
        </div>

        {/* Keeps the panel legible over whatever the map is showing beneath it,
            without washing the density colours out across the whole frame. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-full bg-gradient-to-r from-bark-950/90 via-bark-950/40 to-transparent lg:w-2/3" />

        <div className="absolute inset-0 flex items-end pb-6 sm:items-center sm:pb-0">
          <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
            <div className="w-full max-w-[400px] rounded-3xl border border-parchment-200/15 bg-bark-900/80 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:p-8">
              <Badge
                size={148}
                className="mx-auto w-24 sm:w-[148px]"
                priority
              />

              <p className="mt-4 text-center text-[10px] sm:mt-6 font-medium uppercase tracking-[0.3em] text-ember-400">
                {t("eyebrow")}
              </p>
              <h1 className="mt-3 text-center text-lg font-semibold leading-relaxed text-parchment-50">
                {t("headline")}
              </h1>

              <div className="mt-5 space-y-2 sm:mt-7 sm:space-y-2.5">
                <Link
                  href="/report"
                  className="block rounded-xl bg-ember-500 px-5 py-2.5 text-center text-sm sm:py-3 font-semibold text-bark-950 transition hover:bg-ember-400"
                >
                  {t("ctaReport")}
                </Link>
                <Link
                  href="/map"
                  className="block rounded-xl border border-parchment-200/20 bg-parchment-50/5 px-5 py-2.5 text-center text-sm sm:py-3 font-medium text-parchment-100 transition hover:bg-parchment-50/12"
                >
                  {t("ctaMap")}
                </Link>
                <Link
                  href="/about"
                  className="block rounded-xl border border-parchment-200/20 bg-parchment-50/5 px-5 py-2.5 text-center text-sm sm:py-3 font-medium text-parchment-100 transition hover:bg-parchment-50/12"
                >
                  {t("trustLink")}
                </Link>
                <Link
                  href="/species"
                  className="block rounded-xl border border-parchment-200/20 bg-parchment-50/5 px-5 py-2.5 text-center text-sm sm:py-3 font-medium text-parchment-100 transition hover:bg-parchment-50/12"
                >
                  {t("speciesLink")}
                </Link>
              </div>

              {/* The numbers earn their place here: they are the reason to
                  believe the map underneath is real. */}
              <dl className="mt-5 grid grid-cols-3 sm:mt-7 gap-2 border-t border-parchment-200/12 pt-5 text-center">
                {[
                  { v: n(s.reports), k: t("statsRecords") },
                  { v: n(s.species), k: t("statsSpecies") },
                  { v: years ? String(years) : "—", k: t("statsYears") },
                ].map((x) => (
                  <div key={x.k}>
                    <dt className="sr-only">{x.k}</dt>
                    <dd>
                      <span className="block text-base font-semibold tabular-nums text-parchment-50">
                        {x.v}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-tight text-parchment-400">
                        {x.k}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
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
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-ink-900/10 bg-paper-50 shadow-[0_1px_2px_rgba(22,36,28,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(22,36,28,0.10)]"
            >
              {/* The category's own colour, as a band rather than a 10px dot.
                  It is the same key the map uses, so the two read as one system
                  instead of a legend and an unrelated illustration. */}
              <span
                aria-hidden
                className="block h-1.5 w-full"
                style={{ background: CATEGORIES[x.c].color }}
              />
              <div className="flex flex-1 flex-col p-6">
                <h3 className="text-lg font-semibold text-ink-900">{x.h}</h3>
                <p className="mt-2.5 flex-1 text-sm leading-relaxed text-ink-600">
                  {x.b}
                </p>
                {/* Suppressed at zero rather than printing "0 records" — the
                    seed corpus is entirely roadkill, and advertising an empty
                    category makes a young site look like a dead one. */}
                {x.n > 0 && (
                  <p className="mt-6 flex items-baseline gap-2 border-t border-ink-900/10 pt-4">
                    <span className="text-2xl font-semibold tabular-nums leading-none text-ink-900">
                      {n(x.n)}
                    </span>
                    <span className="text-xs text-ink-500">
                      {t("statsRecords")}
                    </span>
                  </p>
                )}
              </div>
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
                  className="group flex items-baseline gap-3 rounded-lg px-3 py-2.5 -mx-3 transition hover:bg-ink-900/5"
                >
                  <span className="w-4 shrink-0 text-xs tabular-nums text-ink-500">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="truncate text-sm font-medium text-ink-900 group-hover:text-ember-700">
                        {sp.commonNameZh ?? sp.scientificName}
                      </span>
                      {sp.commonNameZh && (
                        <span className="truncate text-[11px] italic text-ink-500">
                          {sp.scientificName}
                        </span>
                      )}
                    </span>
                    {/* A bar makes the long tail legible at a glance: the top
                        species has many times the records of the eighth. */}
                    <span
                      aria-hidden
                      className="mt-1.5 block h-1 overflow-hidden rounded-full bg-ink-900/5"
                    >
                      <span
                        className="block h-full rounded-full bg-moss-700/70"
                        style={{
                          width: `${Math.max(2, (sp.reportCount / speciesMax) * 100)}%`,
                        }}
                      />
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-500">
                    {n(sp.reportCount)}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <Link
            href="/species"
            className="mt-8 inline-block text-sm text-ember-700 transition hover:underline"
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
                <span className="flex size-9 items-center justify-center rounded-full border border-ember-700/30 bg-ember-500/10 text-sm font-semibold text-ember-700">
                  {i + 1}
                </span>
                <h3 className="mt-5 text-base font-semibold text-ink-900">
                  {x.h}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">
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
              className="flex flex-col rounded-xl border border-ink-900/10 bg-paper-50/70 p-7"
            >
              <h2 className="text-lg font-semibold text-ink-900">{x.h}</h2>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-600">
                {x.b}
              </p>
              <Link
                href={x.href}
                className="mt-5 text-sm text-ember-700 transition hover:underline"
              >
                {x.link} →
              </Link>
            </div>
          ))}
        </div>
      </Section>

      {/* ---------------- closing call ---------------- */}
      <section className="border-t border-ink-900/10 bg-paper-100">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-6 py-20 text-center">
          <Badge size={96} />
          <h2 className="max-w-lg text-2xl font-semibold leading-snug text-ink-900">
            {t("finalTitle")}
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-ink-600">
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
          ? "border-y border-ink-900/10 bg-paper-100/60"
          : undefined
      }
    >
      <div className="mx-auto max-w-5xl px-6 py-20 sm:py-24">
        {(eyebrow || title) && (
          <div className="mb-12 max-w-2xl">
            {eyebrow && (
              <p className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.24em] text-ember-700">
                {/* A short rule anchors the eyebrow to the left edge of the
                    grid; alone it floated as a stray line of small caps. */}
                <span aria-hidden className="h-px w-8 bg-ember-700/50" />
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="mt-4 text-[1.75rem] font-semibold leading-tight tracking-tight text-ink-900 sm:text-[2.25rem]">
                {title}
              </h2>
            )}
            {lede && (
              <p className="mt-4 text-base leading-relaxed text-ink-600">
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
