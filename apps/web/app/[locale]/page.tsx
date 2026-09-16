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
import { anniversaryLedger } from "@/lib/stats";
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
 * Rebuilt from purpose after the owner's verdict on the previous version: it
 * didn't look like much, a stranger couldn't tell what the site was, and nobody
 * acted on it. Each of those gets its own mechanism rather than one idea
 * carrying all three.
 *
 * IT HAS NO PHOTOGRAPHS BECAUSE THERE ARE NONE. report_photos holds zero rows —
 * TaiRON publishes no images to GBIF and nobody has ever filed a report here —
 * so every ordinary move for a conservation front page is unavailable. The one
 * picture this project owns is the corpus itself: 46,334 records at 500 m,
 * which resolve into the road network of Taiwan. See app/field.svg.
 *
 * IT OPENS WITH THE FORM'S FIRST QUESTION. Four equally-weighted buttons is no
 * choice at all, and was the old page's answer to "what should I do". The doors
 * each carry one category into /report, so choosing and starting are one act.
 *
 * IT CREDITS 路殺社 BEFORE IT ASKS FOR ANYTHING. Every record displayed here was
 * collected by their volunteers over a decade. A Taiwanese visitor who
 * recognises the data and finds no acknowledgement reads the site as
 * appropriation, and that is a first-impression problem, which makes it this
 * page's problem. The provenance strip is the first thing under the nav.
 *
 * THE BADGE IS HERE ON PURPOSE, WITH ITS LETTERING WRONG. The artwork still
 * reads 生態守望計畫 / PROJECT ECOWATCH, two renames out of date. The design
 * dropped it so the page could ship without waiting for a redraw; the owner put
 * it back so the page can be judged as the whole thing it will be, and the art
 * swapped in later. It sits at 96px rather than the old 160px — present, and
 * not inviting anyone to read the ring.
 *
 * When the new art lands it replaces public/brand-badge.png and nothing here
 * changes.
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
  const [s, ledger] = await Promise.all([getStats(), anniversaryLedger(10)]);
  const zhFirst = locale.startsWith("zh");

  return (
    <main className="bg-paper-50">
      <SiteHeader variant="page" />

      {/* ---------------- provenance ---------------- */}
      {/* Scrolls rather than wraps on a narrow phone: two ragged lines of 11px
          mono under the nav look like a mistake, one clipped line does not. */}
      <div className="border-b border-bark-950 bg-bark-950">
        <div className="mx-auto max-w-[1100px] overflow-x-auto px-6 py-2.5">
          <p className="whitespace-nowrap font-mono text-[11px] tracking-tight text-parchment-400">
            {t("provenanceCounts", {
              count: Number(s.reports),
              from: s.earliest ?? "",
              to: s.latest ?? "",
            })}
            {" · "}
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
          </p>
        </div>
      </div>

      {/* ---------------- the doorway ---------------- */}
      <section className="mx-auto max-w-[1100px] px-6 pb-16 pt-12 sm:pt-16">
        {/* Left-aligned with everything else. Centred under a centred column is
            the shape this redesign was called a generic template for. */}
        <Badge size={96} className="mb-7 w-16 sm:w-24" priority />
        <h1 className="max-w-3xl text-[clamp(2rem,7vw,3.5rem)] font-semibold leading-[1.08] text-ink-900">
          {t("ask")}
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-600">
          {t("askHint")}
        </p>

        <ul className="mt-9 grid gap-3 sm:grid-cols-3">
          {DOORS.map((d) => (
            <li key={d.group}>
              <Link
                href={`/report?category=${d.key}`}
                className="flex h-full flex-col rounded-lg border border-ink-900/12 bg-paper-100 transition hover:border-ink-900/30 hover:bg-paper-200/60"
              >
                <span
                  aria-hidden
                  className="block h-1.5 w-full rounded-t-lg"
                  style={{ background: CATEGORIES[d.key as Category].color }}
                />
                <span className="flex flex-1 flex-col gap-1.5 p-4">
                  <span className="text-[17px] font-medium leading-snug text-ink-900">
                    {tr(`group.${d.group}`)}
                  </span>
                  <span className="text-[12px] leading-relaxed text-ink-500">
                    {t(d.copy)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <Link
          href="/about"
          className="mt-7 inline-block text-[13px] text-ink-500 transition hover:text-ink-900"
        >
          {t("firstTime")} →
        </Link>
      </section>

      {/* ---------------- the plate ---------------- */}
      <section className="border-y border-ink-900/10 bg-paper-100/60">
        <div className="mx-auto grid max-w-[1100px] gap-10 px-6 py-16 lg:grid-cols-[minmax(0,460px)_1fr] lg:items-center lg:gap-20 lg:py-24">
          {/* eslint-disable-next-line @next/next/no-img-element --
              A generated SVG route, not a file next/image can optimise. */}
          <img
            src="/field.svg"
            alt=""
            width={900}
            height={1668}
            className="mx-auto w-full max-w-[300px] sm:max-w-[360px] lg:max-w-none"
          />
          <div>
            <h2 className="text-2xl font-semibold leading-snug text-ink-900 sm:text-3xl">
              {t("plateTitle", { count: Number(s.reports) })}
            </h2>
            <p className="mt-5 max-w-lg text-sm leading-relaxed text-ink-600">
              {t("plateCaption")}
            </p>
            <Link
              href="/map"
              className="mt-6 inline-block text-sm font-medium text-ember-700 transition hover:underline"
            >
              {t("ctaMap")} →
            </Link>
          </div>
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
