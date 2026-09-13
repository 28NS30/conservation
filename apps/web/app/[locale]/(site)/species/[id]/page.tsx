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
  isIndexworthy,
  habitatKnown,
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
  try {
    const rows = await asPublic(
      (tx) => tx<{ id: number; scientific_name: string }[]>`
        select t.id, t.scientific_name
          from taxa t join species_report_stats s on s.taxon_id = t.id
         order by s.report_count desc limit 400`,
    );
    return rows.map((r) => ({
      id: speciesSlug({ id: r.id, scientificName: r.scientific_name }),
    }));
  } catch (e) {
    // Prerendering is an optimisation, not a correctness requirement: every one
    // of these pages already renders on demand, which is how the other ~65,850
    // taxa work. Letting an unreachable database abort the whole build meant a
    // wrong password — or a Supabase maintenance window — blocked deploying
    // anything at all, including the fix for the password.
    //
    // Loud on purpose. A deploy that silently stops prerendering 400 pages is a
    // performance regression nobody would notice otherwise, and the runtime
    // health of the database is checked separately by /api/health and
    // `npm run verify:deploy`.
    console.error(
      "[build] species prerendering skipped — database unreachable:",
      (e as Error).message,
    );
    return [];
  }
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
  const name =
    locale.startsWith("zh") && s.commonNameZh
      ? s.commonNameZh
      : s.scientificName;
  return {
    title: name,
    description: t("metaDescription", { name, count: s.reportCount }),
    /*
     * A page with nothing but a name and a rank is thin, and a crawler that
     * finds a hundred thousand near-identical ones forms a view of the whole
     * domain from them. But "has anyone reported it" was the wrong test: this
     * page renders a lineage, a habitat and up to four conservation assessments
     * without any user data at all. See isIndexworthy() — it asks whether the
     * page says something distinguishing, which 24,243 species do and the rest
     * do not.
     *
     * The rest stay reachable and useful either way: the directory links them,
     * search within the site finds them, and `follow` stays on so the taxonomy
     * links out of them still carry.
     */
    ...(isIndexworthy(s) ? null : { robots: { index: false, follow: true } }),
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
  if (id !== canonical)
    redirect(`/${locale}/species/${canonical}`.replace("/zh-TW/", "/"));

  const t = await getTranslations("species");
  const nav = await getTranslations("nav");

  const zhFirst = locale.startsWith("zh");
  const headline =
    zhFirst && s.commonNameZh ? s.commonNameZh : s.scientificName;
  const secondary =
    zhFirst && s.commonNameZh ? s.scientificName : s.commonNameZh;

  const lineage = [s.kingdom, s.phylum, s.class, s.order, s.family].filter(
    Boolean,
  ) as string[];
  // Only meaningful when at least one flag is non-NULL; see habitatKnown().
  const habitats = habitatKnown(s)
    ? (
        [
          [s.isTerrestrial, "terrestrial"],
          [s.isFreshwater, "freshwater"],
          [s.isBrackish, "brackish"],
          [s.isMarine, "marine"],
        ] as const
      )
        .filter(([on]) => on === true)
        .map(([, key]) => t(`habitat.${key}`))
    : [];

  // A 座標不開放 taxon has no rows in reports_public at all, so `reportCount` is
  // 0 even when records exist. Say that plainly rather than rendering a
  // misleading "no reports yet" — it reveals nothing a poacher can use, since
  // TaiCOL already publishes which species occur in Taiwan.
  const withheld = s.sensitivity === "座標不開放";
  const counts =
    s.reportCount >= HEATMAP_MIN_RECORDS ? await monthlyCounts(s.id) : null;
  const records =
    !withheld && s.reportCount > 0 && s.reportCount <= LIST_MAX_RECORDS
      ? await recentRecords(s.id)
      : [];

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-24 pt-10">
      <Link href="/species" className="text-xs text-ink-500 hover:text-ink-700">
        {nav("backToSpecies")}
      </Link>

      {/* The species name is this page's title, so it is set like one — the rest
          of the site moved to a 3xl h1 and this was left at 20px. */}
      <header className="mt-5">
        <h1 className="text-3xl font-semibold leading-tight text-ink-900">
          {headline}
        </h1>
        {secondary && (
          <p className="mt-2 text-base text-ink-600">
            <span className="italic">{secondary}</span>
            {s.nameAuthor && (
              <span className="ml-1.5 not-italic text-ink-500">
                {s.nameAuthor}
              </span>
            )}
          </p>
        )}
        {s.altNamesZh && s.altNamesZh.length > 0 && (
          <p className="mt-1 text-xs text-ink-500">
            {t("alsoKnownAs")}: {s.altNamesZh.join("、")}
          </p>
        )}
        <StatusBadges {...s} />
      </header>

      {lineage.length > 0 && (
        <nav
          aria-label={t("taxonomy")}
          className="mt-4 text-[11px] text-ink-500"
        >
          {lineage.join(" › ")}
          {habitats.length > 0 && (
            <span className="ml-2 text-ink-500">· {habitats.join(" / ")}</span>
          )}
        </nav>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink-900">{t("records")}</h2>

        {withheld ? (
          <p className="mt-2 rounded-lg border border-amber-700/30 bg-amber-600/10 px-3 py-2.5 text-[12px] leading-relaxed text-amber-800">
            {t("coordinatesWithheld")}
          </p>
        ) : s.reportCount === 0 ? (
          <div className="mt-2 rounded-lg border border-ink-900/10 bg-paper-100 px-3 py-4 text-center">
            <p className="text-sm text-ink-500">{t("noRecords")}</p>
            <Link
              href="/report"
              className="mt-3 inline-block rounded-full bg-ember-500 px-3.5 py-1.5 text-xs font-semibold text-bark-950 hover:bg-ember-400"
            >
              + {t("beFirst")}
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-600">
              {t("recordCount", { count: s.reportCount })}
              {s.firstSeen && s.lastSeen && (
                <span className="ml-2 text-ink-500">
                  {new Date(s.firstSeen).getFullYear()}–
                  {new Date(s.lastSeen).getFullYear()}
                </span>
              )}
            </p>

            <div className="mt-3">
              <SpeciesMap
                taxonId={s.id}
                reportCount={s.reportCount}
                maptilerKey={process.env.NEXT_PUBLIC_MAPTILER_KEY || undefined}
              />
            </div>

            {s.sensitivity && (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-700/80">
                {t("blurredNotice")}
              </p>
            )}

            {records.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs">
                {records.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded border border-ink-900/10 px-2.5 py-1.5"
                  >
                    <Link
                      href={`/reports/${r.id}`}
                      className="text-ink-600 hover:text-ink-800"
                    >
                      {new Date(r.observedAt).toLocaleDateString(locale, {
                        timeZone: "Asia/Taipei",
                      })}
                    </Link>
                    <span className="tabular-nums text-ink-500">
                      {r.lat.toFixed(3)}, {r.lng.toFixed(3)}
                      {r.isObscured && (
                        <span className="ml-1.5 text-amber-700">≈</span>
                      )}
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
          className="mt-6 inline-block rounded-full border border-ink-900/12 px-3.5 py-1.5 text-xs text-ink-600 hover:bg-paper-200"
        >
          + {t("seenOne")}
        </Link>
      )}
    </main>
  );
}
