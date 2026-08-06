import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { asPublic } from "@/lib/db";
import {
  getSpecies,
  monthlyCounts,
  recentRecords,
  speciesSlug,
  parseSpeciesId,
} from "@/lib/species";
import StatusBadges from "@/components/species/StatusBadges";
import MonthlyChart from "@/components/species/MonthlyChart";
import SpeciesMap from "@/components/species/SpeciesMap";

/** A heatmap built from a handful of points is noise; below this we plot them. */
const HEATMAP_MIN_RECORDS = 6;
/** Sparse species list their records outright. */
const LIST_MAX_RECORDS = 5;

/**
 * Only the ~354 species that actually have records are pre-rendered. The other
 * ~65,850 render on demand — generating 66k static pages would be absurd for
 * content that is mostly "no reports yet".
 */
export async function generateStaticParams() {
  const rows = await asPublic(
    (tx) => tx<{ id: number; scientific_name: string }[]>`
      select t.id, t.scientific_name
        from taxa t join species_report_stats s on s.taxon_id = t.id
       order by s.report_count desc limit 400`,
  );
  return rows.map((r) => ({
    id: speciesSlug({ id: r.id, scientificName: r.scientific_name }),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const taxonId = parseSpeciesId(id);
  if (!taxonId) return {};
  const s = await getSpecies(taxonId);
  if (!s) return {};
  const t = await getTranslations({ locale, namespace: "species" });
  const name = locale.startsWith("zh") && s.commonNameZh ? s.commonNameZh : s.scientificName;
  return {
    title: name,
    description: t("metaDescription", { name, count: s.reportCount }),
  };
}

export default async function SpeciesPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const taxonId = parseSpeciesId(id);
  if (!taxonId) notFound();

  const s = await getSpecies(taxonId);
  if (!s) notFound();

  // Canonicalise `/species/32116` to `/species/32116-prionailurus-bengalensis`.
  const canonical = speciesSlug(s);
  if (id !== canonical) redirect(`/${locale}/species/${canonical}`.replace("/zh-TW/", "/"));

  const t = await getTranslations("species");
  const nav = await getTranslations("nav");

  const zhFirst = locale.startsWith("zh");
  const headline = zhFirst && s.commonNameZh ? s.commonNameZh : s.scientificName;
  const secondary = zhFirst && s.commonNameZh ? s.scientificName : s.commonNameZh;

  const lineage = [s.kingdom, s.phylum, s.class, s.order, s.family].filter(Boolean) as string[];
  const habitats = (
    [
      [s.isTerrestrial, "terrestrial"],
      [s.isFreshwater, "freshwater"],
      [s.isBrackish, "brackish"],
      [s.isMarine, "marine"],
    ] as const
  )
    .filter(([on]) => on)
    .map(([, key]) => t(`habitat.${key}`));

  // A 座標不開放 taxon has no rows in reports_public at all, so `reportCount` is
  // 0 even when records exist. Say that plainly rather than rendering a
  // misleading "no reports yet" — it reveals nothing a poacher can use, since
  // TaiCOL already publishes which species occur in Taiwan.
  const withheld = s.sensitivity === "座標不開放";
  const counts = s.reportCount >= HEATMAP_MIN_RECORDS ? await monthlyCounts(s.id) : null;
  const records = !withheld && s.reportCount > 0 && s.reportCount <= LIST_MAX_RECORDS
    ? await recentRecords(s.id)
    : [];

  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-2xl px-4 pb-16 pt-5">
      <Link href="/species" className="text-xs text-parchment-400 hover:text-parchment-200">
        {nav("backToSpecies")}
      </Link>

      <header className="mt-3">
        <h1 className="text-xl font-semibold text-parchment-50">{headline}</h1>
        {secondary && (
          <p className="mt-0.5 text-sm text-parchment-400">
            <span className="italic">{secondary}</span>
            {s.nameAuthor && <span className="ml-1.5 not-italic text-parchment-500">{s.nameAuthor}</span>}
          </p>
        )}
        {s.altNamesZh && s.altNamesZh.length > 0 && (
          <p className="mt-1 text-xs text-parchment-500">
            {t("alsoKnownAs")}: {s.altNamesZh.join("、")}
          </p>
        )}
        <StatusBadges {...s} />
      </header>

      {lineage.length > 0 && (
        <nav aria-label={t("taxonomy")} className="mt-4 text-[11px] text-parchment-500">
          {lineage.join(" › ")}
          {habitats.length > 0 && <span className="ml-2 text-parchment-500">· {habitats.join(" / ")}</span>}
        </nav>
      )}

      <section className="mt-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-parchment-500">
          {t("records")}
        </h2>

        {withheld ? (
          <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-[12px] leading-relaxed text-amber-200">
            {t("coordinatesWithheld")}
          </p>
        ) : s.reportCount === 0 ? (
          <div className="mt-2 rounded-lg border border-parchment-200/10 bg-bark-900/50 px-3 py-4 text-center">
            <p className="text-sm text-parchment-400">{t("noRecords")}</p>
            <Link
              href="/report"
              className="mt-3 inline-block rounded-full bg-ember-500 px-3.5 py-1.5 text-xs font-semibold text-bark-950 hover:bg-ember-400"
            >
              + {t("beFirst")}
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-parchment-300">
              {t("recordCount", { count: s.reportCount })}
              {s.firstSeen && s.lastSeen && (
                <span className="ml-2 text-parchment-500">
                  {new Date(s.firstSeen).getFullYear()}–{new Date(s.lastSeen).getFullYear()}
                </span>
              )}
            </p>

            <div className="mt-3">
              <SpeciesMap
                taxonId={s.id}
                mode={s.reportCount >= HEATMAP_MIN_RECORDS ? "heat" : "points"}
                maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined}
              />
            </div>

            {s.sensitivity && (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">
                {t("blurredNotice")}
              </p>
            )}

            {records.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs">
                {records.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 rounded border border-parchment-200/10 px-2.5 py-1.5">
                    <Link href={`/reports/${r.id}`} className="text-parchment-300 hover:text-parchment-100">
                      {new Date(r.observedAt).toLocaleDateString(locale, { timeZone: "Asia/Taipei" })}
                    </Link>
                    <span className="tabular-nums text-parchment-500">
                      {r.lat.toFixed(3)}, {r.lng.toFixed(3)}
                      {r.isObscured && <span className="ml-1.5 text-amber-400">≈</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {counts && (
              <div className="mt-6">
                <MonthlyChart counts={counts} />
              </div>
            )}
          </>
        )}
      </section>

      {!withheld && s.reportCount > 0 && (
        <Link
          href="/report"
          className="mt-6 inline-block rounded-full border border-parchment-200/15 px-3.5 py-1.5 text-xs text-parchment-300 hover:bg-bark-800"
        >
          + {t("seenOne")}
        </Link>
      )}
    </main>
  );
}
