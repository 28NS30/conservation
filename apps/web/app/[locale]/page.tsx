import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { sql } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import {
  CATEGORIES,
  REPORT_GROUPS,
  REPORT_GROUP_KEYS,
  type Category,
} from "@conservation/shared";
import { anniversaryLedger, mapEntrySpecies } from "@/lib/stats";
import Badge from "@/components/brand/Badge";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";

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
           extract(year from min(observed_at))::text     as earliest,
           extract(year from max(observed_at))::text     as latest
      from reports_public`;
  return row;
}

/**
 * Places to start the map from, each a z11 view with records in it (a test
 * checks). Chosen to spread across the island — north, west, east and south —
 * rather than to rank anything.
 */
const MAP_PLACES = [
  { key: "yangmingshan", lng: 121.55, lat: 25.17 },
  { key: "taichung", lng: 120.68, lat: 24.15 },
  { key: "hualien", lng: 121.6, lat: 23.98 },
  { key: "kenting", lng: 120.8, lat: 21.95 },
] as const;

/**
 * The doors, in the order the form offers them.
 *
 * Three, not four, and generated from REPORT_GROUPS so that the front page and
 * the form can never offer different choices. Each links to the group's first
 * category; the roadkill door's dead/injured sub-choice is asked on the form,
 * where the answer is in front of the person who saw the animal.
 */
const DOORS = REPORT_GROUP_KEYS.map((g) => ({
  group: g,
  key: REPORT_GROUPS[g].categories[0],
  copy: `door${g[0].toUpperCase()}${g.slice(1)}` as const,
}));

/**
 * The front door.
 *
 * IT OPENS WITH THE BADGE, LARGE, AND ALMOST NOTHING BESIDE IT. The owner asked
 * for exactly that after the previous version: a much bigger logo with only a
 * little text next to it. So the badge is 320px on a desktop, and beside it the
 * name in both scripts and one line saying what this is. Everything that
 * explains the project in more detail sits further down, for the reader who
 * wants it.
 *
 * THE BADGE IS HERE WITH ITS LETTERING WRONG. The artwork still reads
 * 生態守望計畫 / PROJECT ECOWATCH, two renames out of date, and the owner kept it
 * so the page can be judged as the whole thing it will be. At 320px it is also
 * past what the 512px source can draw sharply on a 2x screen. The redraw should
 * be 1024px or an SVG, and replaces public/brand-badge.png with nothing here
 * changing.
 *
 * THEN THE FORM'S FIRST QUESTION. The doors each carry one report type into
 * /report, so choosing and starting are one act.
 *
 * IT CREDITS 路殺社 BEFORE IT ASKS FOR ANYTHING. Every record displayed here was
 * collected by their volunteers over a decade. A Taiwanese visitor who
 * recognises the data and finds no acknowledgement reads the site as
 * appropriation, and that is a first-impression problem, which makes it this
 * page's problem. The provenance strip is the first thing under the nav.
 *
 * THERE IS NO PICTURE OF THE DATA. The previous version's centrepiece was every
 * record drawn at 500 m in the shape of the island, titled with the count; the
 * owner did not want the page to lead with a count, and it was also the page's
 * heaviest element by far. In its place is a band of ways into the map — start
 * from an animal, or from a place — that loads none of the map itself.
 *
 * IT HAS NO PHOTOGRAPHS BECAUSE THERE ARE NONE. report_photos holds zero rows:
 * TaiRON publishes no images to GBIF and nobody has filed a report here yet.
 */
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("home");
  // Door labels come from the form's own strings, so the two cannot drift.
  const tr = await getTranslations("report");
  const [s, ledger, entrySpecies] = await Promise.all([
    getStats(),
    anniversaryLedger(10),
    mapEntrySpecies(3),
  ]);
  const zhFirst = locale.startsWith("zh");

  return (
    <main className="bg-paper-50">
      <SiteHeader variant="page" wide />

      {/* ---------------- provenance ---------------- */}
      {/* Before anything is asked of the reader, the site says whose records
          these are. One line from `sm` up; two lines on a phone, where a single
          scrolling line of 11px mono was clipped mid-credit. */}
      <div className="border-b border-bark-950 bg-bark-950">
        <div className="mx-auto max-w-[1100px] px-6 py-2.5 sm:overflow-x-auto">
          <p className="font-mono text-[11px] leading-relaxed tracking-tight text-parchment-400 sm:whitespace-nowrap">
            <span className="block sm:inline">
              {t("provenanceCounts", {
                count: Number(s.reports),
                from: s.earliest ?? "",
                to: s.latest ?? "",
              })}
            </span>
            <span className="hidden sm:inline">{" · "}</span>
            <span className="block sm:inline">
              {t("provenanceSource")}{" "}
              <a
                href="https://roadkill.tw"
                target="_blank"
                rel="noopener noreferrer"
                className="text-parchment-200 underline underline-offset-2 hover:text-parchment-50"
              >
                {t("provenanceOrg")}
              </a>{" "}
              {t("provenanceVia")}
            </span>
          </p>
        </div>
      </div>

      {/* ---------------- the emblem ---------------- */}
      <section className="mx-auto max-w-[1100px] px-4 pt-6 sm:px-6 sm:pt-14 lg:pt-16">
        {/* The badge is the page's subject, and beside it only the name and one
            line. Beside at every width: stacked on a phone, the name fell below
            the fold under a 300px circle. 320px is past what the 512px source
            can do sharply on a 2x screen — a 1024px or SVG badge drops into
            public/brand-badge.png with no code change. */}
        <div className="flex items-center gap-4 sm:gap-8 lg:gap-12">
          <Badge
            size={320}
            priority
            sizes="(min-width: 1024px) 320px, (min-width: 640px) 272px, 172px"
            className="w-[min(44vw,172px)] shrink-0 shadow-[0_1px_2px_rgb(22_36_28/0.12),0_18px_36px_-24px_rgb(22_36_28/0.38)] sm:w-[272px] lg:w-[320px] [@media(min-width:1024px)_and_(max-height:760px)]:w-[272px]"
          />
          <div className="min-w-0">
            {/* Both names are the h1, in both locales. They are the project's
                name rather than copy, so they are not translated; the lang
                attribute keeps a screen reader on /en from reading the Chinese
                as English. */}
            <h1 className="text-ink-900">
              {/* Each half is unbreakable, so a wrap can only ever fall between
                  福爾摩沙 and 守望計畫 — never 福爾摩沙守望 / 計畫, which is what
                  a 640–699px window showed. The two halves share a line only
                  from md up, where the column is wide enough for all eight
                  characters; on a phone the size scales with the screen, so a
                  320px window (the WCAG reflow width) keeps each half whole. */}
              <span
                lang="zh-TW"
                className="block text-[clamp(26px,9vw,34px)] font-medium leading-[1.12] tracking-[0.06em] sm:text-[40px] lg:text-[50px] lg:tracking-[0.12em]"
              >
                <span className="block whitespace-nowrap md:inline">福爾摩沙</span>
                <span className="block whitespace-nowrap md:inline">守望計畫</span>
              </span>
              {/* One line from 360px up; below that it may wrap between the two
                  words rather than push the page sideways. */}
              <span className="mt-2 flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.1em] text-ink-500 min-[360px]:whitespace-nowrap sm:mt-3 sm:text-[13px] sm:tracking-[0.36em]">
                <span
                  aria-hidden
                  className="hidden size-1.5 rounded-full bg-ember-500 sm:block"
                />
                Project FormosaWatch
              </span>
            </h1>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-700 [text-wrap:balance] sm:mt-5 sm:border-t sm:border-ink-900/12 sm:pt-5 sm:text-[19px] sm:[text-wrap:pretty]">
              {t("tagline")}
            </p>
          </div>
        </div>

        {/* ---------------- the ask ---------------- */}
        {/* Spacing on a phone is tighter than it looks like it should be, on
            purpose: all three doors have to clear the fold on a 360x740 screen
            in English, whose door descriptions wrap to more lines than the
            Chinese. The page spec checks it. */}
        <div className="mt-7 flex flex-wrap items-baseline gap-x-4 gap-y-1 sm:mt-12">
          <h2 className="text-2xl font-semibold text-ink-900 sm:text-3xl">
            {t("ask")}
          </h2>
          <p className="text-sm text-ink-600">{t("askHint")}</p>
        </div>

        <ul className="mt-4 grid gap-2.5 sm:mt-5 sm:grid-cols-3 sm:gap-3">
          {DOORS.map((d) => (
            <li key={d.group}>
              {/* On a phone the colour runs down the left edge and the arrow
                  sits right, so three stacked doors read as a list of choices
                  rather than three tall cards. */}
              <Link
                href={`/report?category=${d.key}`}
                className="grid h-full grid-cols-[5px_1fr_auto] items-center overflow-hidden rounded-lg border border-ink-900/12 bg-paper-100 transition hover:border-ink-900/30 hover:bg-paper-200/60 sm:grid-cols-1 sm:items-stretch"
              >
                <span
                  aria-hidden
                  className="block h-full w-[5px] sm:h-1.5 sm:w-full"
                  style={{ background: CATEGORIES[d.key as Category].color }}
                />
                <span className="flex flex-col gap-1 px-4 py-3 sm:gap-1.5 sm:p-4">
                  <span className="flex items-center justify-between gap-3 text-[17px] font-medium leading-snug text-ink-900">
                    {tr(`group.${d.group}`)}
                    <span aria-hidden className="hidden text-ink-500 sm:inline">
                      →
                    </span>
                  </span>
                  <span className="text-[12px] leading-snug text-ink-500 sm:leading-relaxed">
                    {t(d.copy)}
                  </span>
                </span>
                <span aria-hidden className="pr-4 text-ink-500 sm:hidden">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <Link
          href="/about"
          className="mt-6 inline-block pb-14 text-[13px] text-ink-500 transition hover:text-ink-900 sm:pb-16"
        >
          {t("firstTime")} →
        </Link>
      </section>

      {/* ---------------- ways into the map ---------------- */}
      {/* Where the island plate was. It was an image of the record count in the
          shape of Taiwan, and the owner did not want the page to lead with a
          count. This offers the map as something to use — start from an animal,
          or from a place — and loads nothing of the map itself: MapLibre stays
          on /map, where it is the point. */}
      <section className="border-y border-ink-900/10 bg-paper-100/60">
        <div className="mx-auto grid max-w-[1100px] gap-6 px-6 py-10 sm:py-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-16">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ember-700">
              {t("mapKicker")}
            </p>
            <h2 className="mt-3 max-w-2xl text-xl font-semibold leading-snug text-ink-900 [text-wrap:pretty] sm:text-2xl">
              {t.rich("mapLine", {
                ph: (c) => <span className="inline-block">{c}</span>,
              })}
            </h2>
            <dl className="mt-6 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[auto_1fr] sm:items-baseline">
              <dt className="text-ink-500">{t("mapSpeciesLabel")}</dt>
              <dd>
                <ul className="flex flex-wrap gap-2">
                  {entrySpecies.map((sp) => (
                    <li key={sp.id}>
                      <Link
                        href={`/map?taxonId=${sp.id}`}
                        className={`inline-block rounded-full border border-ink-900/15 bg-paper-50 px-3 py-1 text-[13px] text-ink-800 transition hover:border-ink-900/35 ${zhFirst ? "" : "italic"}`}
                      >
                        {zhFirst ? sp.commonNameZh : sp.scientificName}
                      </Link>
                    </li>
                  ))}
                </ul>
              </dd>
              <dt className="text-ink-500">{t("mapPlacesLabel")}</dt>
              <dd>
                <ul className="flex flex-wrap gap-2">
                  {MAP_PLACES.map((pl) => (
                    <li key={pl.key}>
                      <Link
                        href={`/map?lng=${pl.lng}&lat=${pl.lat}&z=11`}
                        className="inline-block rounded-full border border-ink-900/15 bg-paper-50 px-3 py-1 text-[13px] text-ink-800 transition hover:border-ink-900/35"
                      >
                        {t(`places.${pl.key}`)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </dd>
            </dl>
          </div>
          <Link
            href="/map"
            className="text-sm font-medium text-ember-700 transition hover:underline"
          >
            {t("ctaMap")} →
          </Link>
        </div>
      </section>

      {/* ---------------- three answers ---------------- */}
      <section className="mx-auto max-w-[1100px] px-6 py-16">
        <dl className="grid gap-8 sm:grid-cols-3 sm:gap-10">
          {[
            ["whatTitle", "whatBody"],
            ["whoTitle", "whoBody"],
            ["taironTitle", "taironBody"],
          ].map(([h, b], i) => (
            <div
              key={h}
              className={
                i > 0
                  ? "border-t border-ink-900/10 pt-8 sm:border-l sm:border-t-0 sm:pl-8 sm:pt-0"
                  : ""
              }
            >
              <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-ember-700">
                {t(h)}
              </dt>
              <dd className="mt-3 text-sm leading-relaxed text-ink-600">
                {t(b)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------------- the ledger ---------------- */}
      <section className="border-t border-ink-900/10 bg-paper-100/60">
        <div className="mx-auto max-w-[1100px] px-6 py-16">
          <h2 className="text-2xl font-semibold text-ink-900 sm:text-3xl">
            {t("ledgerTitle")}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-600">
            {t("ledgerHint")}
          </p>

          <div className="mt-8 border-t border-ink-900/12">
            {/* The blank line. It is the call to action, in the geometry of a
                record — the argument for filing one is that the next line of
                the ledger is empty. */}
            <Link
              href="/report"
              className="flex items-center gap-4 border-b border-dashed border-ember-500/70 px-1 py-3.5 transition hover:bg-ember-500/8"
            >
              <span className="font-mono text-[12px] tabular-nums text-ember-700/70">
                ————-——-——
              </span>
              <span className="flex-1 text-sm font-medium text-ember-700">
                {t("ledgerBlank")} →
              </span>
            </Link>

            {ledger.map((r) => {
              const name =
                zhFirst && r.commonNameZh ? r.commonNameZh : r.scientificName;
              const second =
                zhFirst && r.commonNameZh ? r.scientificName : r.commonNameZh;
              return (
                <Link
                  key={r.id}
                  href={`/reports/${r.id}`}
                  className="flex items-baseline gap-4 border-b border-ink-900/8 px-1 py-3 transition hover:bg-paper-200/50"
                >
                  <span className="font-mono text-[12px] tabular-nums text-ink-500">
                    {new Date(r.observedAt).toISOString().slice(0, 10)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] text-ink-900">
                    {name}
                    {second && (
                      <span className="ml-2 text-[11px] italic text-ink-500">
                        {second}
                      </span>
                    )}
                  </span>
                  <span className="hidden font-mono text-[11px] tabular-nums text-ink-500 sm:inline">
                    {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link
              href="/reports"
              className="font-medium text-ember-700 transition hover:underline"
            >
              {t("ledgerAll", { count: Number(s.reports) })} →
            </Link>
            <Link
              href="/species"
              className="text-ink-600 transition hover:text-ink-900"
            >
              {t("speciesLink")} →
            </Link>
          </div>
        </div>
      </section>

      {/* ---------------- how it works ---------------- */}
      <section className="mx-auto max-w-[1100px] px-6 py-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ember-700">
          {t("howTitle")}
        </p>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold leading-snug text-ink-900 sm:text-3xl">
          {t("howHeading")}
        </h2>
        <ol className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-10">
          {[
            ["how1", "how1Body"],
            ["how2", "how2Body"],
            ["how3", "how3Body"],
          ].map(([h, b], i) => (
            <li key={h} className="border-t border-ink-900/12 pt-5">
              <span className="font-mono text-[11px] tabular-nums text-ink-500">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 text-base font-semibold text-ink-900">
                {t(h)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                {t(b)}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------- trust, and the close ---------------- */}
      <section className="border-t border-ink-900/10 bg-paper-100/60">
        <div className="mx-auto grid max-w-[1100px] gap-10 px-6 py-16 sm:grid-cols-2 sm:gap-14">
          {[
            ["trustTitle", "trustBody", "trustLink", "/about"] as const,
            ["openTitle", "openBody", "openLink", "/attribution"] as const,
          ].map(([h, b, l, href]) => (
            <div key={h}>
              <h2 className="text-lg font-semibold text-ink-900">{t(h)}</h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-600">
                {t(b)}
              </p>
              <Link
                href={href}
                className="mt-4 inline-block text-sm font-medium text-ember-700 transition hover:underline"
              >
                {t(l)} →
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-6 py-20">
        <h2 className="max-w-2xl text-2xl font-semibold leading-snug text-ink-900 sm:text-3xl">
          {t("closeTitle")}
        </h2>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-600">
          {t("closeBody")}
        </p>
        <Link
          href="/report"
          className="mt-7 inline-block rounded-full bg-ember-500 px-6 py-3 text-sm font-semibold text-bark-950 transition hover:bg-ember-400"
        >
          {t("ctaReport")}
        </Link>
      </section>

      <SiteFooter obscured={s.obscured} />
    </main>
  );
}
