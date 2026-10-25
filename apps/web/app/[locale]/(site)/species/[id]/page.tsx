import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { asPublic, sql } from "@/lib/db";
import { speciesNotes } from "@/lib/speciesNotes";
import {
  getCachedSpecies,
  isSpeciesAddress,
  monthlyCounts,
  LIST_MAX_RECORDS,
  speciesSlug,
  parseSpeciesId,
  isIndexworthy,
} from "@/lib/species";
import SpeciesStatus from "@/components/species/SpeciesStatus";
import HabitatChips from "@/components/species/HabitatChips";
import MonthlyChart from "@/components/species/MonthlyChart";
import SpeciesMap from "@/components/species/SpeciesMap";
import SpeciesName from "@/components/species/SpeciesName";
import SpeciesRecords from "@/components/species/SpeciesRecords";
import { speciesLabel } from "@/lib/speciesNames";
import { alternates } from "@/lib/alternates";

/** A heatmap built from a handful of points is noise; below this we plot them. */
const HEATMAP_MIN_RECORDS = 6;

/**
 * Rendered once, then served from the cache for everybody, and rebuilt when it
 * is asked for more than five minutes on. Until the header stopped reading
 * cookies (components/auth/AccountLink) every species page rendered per
 * request and this had nothing to act on.
 *
 * Five minutes is not what keeps a record off a page it has left. A sparse
 * species lists its records with their points, and a record re-identified as
 * a blurred species, or thrown out, must not stay listed under its old name
 * until somebody happens to ask twice. The taxon and its monthly counts are
 * read through the cache tagged with the reports (getCachedSpecies,
 * monthlyCounts; lib/siteFigures.ts), so the page carries the tag, and every
 * writer that changes a record drops it at once.
 *
 * The records themselves, each with its point, are not on the cached page at
 * all: the browser asks for them per request (SpeciesRecords, from
 * /api/species/[id]/records). A blur tightened in the database, where no
 * writer runs, therefore reaches the list at once, however long a cache
 * keeps the page around it. That matters because how long is not this app's
 * to say for most species pages: on Vercel a page rendered on its first visit
 * is stored under the platform's defaults for an on-demand route, not the
 * `expireTime` the prerendered ones are given (see the route).
 */
export const revalidate = 300;

/**
 * The 50 most-recorded species are rendered at build; every other species
 * page, recorded or not, renders on its first visit and is cached from then
 * on, on the same five-minute rule.
 *
 * It was the 400 most-recorded: 800 of the build's 884 pages, each three or
 * four database reads, with every build worker holding its own pool of
 * connections. That is what exhausted a local Postgres, and it bought
 * nothing, because the pages were rendered per request anyway (see
 * `revalidate`). Built or not, a page costs one render and is then the
 * cache's; building the rest only moves that render from the page's first
 * visitor into every deploy.
 */
export async function generateStaticParams() {
  try {
    const rows = await asPublic(
      (tx) => tx<{ id: number; scientific_name: string }[]>`
        select t.id, t.scientific_name
          from taxa t join species_report_stats s on s.taxon_id = t.id
         -- t.id settles ties, so the same fifty are chosen on every build.
         order by s.report_count desc, t.id limit 50`,
    );
    return rows.map((r) => ({
      id: speciesSlug({ id: r.id, scientificName: r.scientific_name }),
    }));
  } catch (e) {
    // Prerendering is an optimisation, not a correctness requirement: every one
    // of these pages already renders on demand, which is how the other ~68,000
    // taxa work. Letting an unreachable database abort the whole build meant a
    // wrong password — or a Supabase maintenance window — blocked deploying
    // anything at all, including the fix for the password.
    //
    // Loud on purpose. A deploy that silently stops prerendering 100 pages is a
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
  if (!taxonId || !(await isSpeciesAddress(id, taxonId))) return {};
  const s = await getCachedSpecies(taxonId);
  if (!s) return {};
  const t = await getTranslations({ locale, namespace: "species" });
  // Both names in the title, the page's language first: a search result for
  // "Leopard Cat" should say 石虎 too, and the other way round.
  const name = speciesLabel(s, locale);
  return {
    title: name,
    description: t("metaDescription", { name, count: s.reportCount }),
    alternates: alternates(locale, `/species/${speciesSlug(s)}`),
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

  // Only the taxon's own address, `32116-prionailurus-bengalensis`, is its
  // page. A bare id never gets here: it is rewritten to species/by-id, which
  // redirects to the slug per request (see there for why the redirect is not
  // made in this cached page). Any other slug is not found. It used to be
  // shown as the page it named, so every `<id>-<anything>` was a page of its
  // own in the cache, and an id that names no taxon made a cached entry of
  // its own; both now cost one read by the primary key, before anything
  // cached, and a 404. While the page rendered per request a wrong slug was
  // redirected to the right one; from this cached page a redirect is
  // answered with its Location twice, and each slug would still be an entry.
  // An old link from before a rename is the one casualty: nothing keeps old
  // names, and `/species/<id>` still finds the page.
  if (!(await isSpeciesAddress(id, taxonId))) notFound();

  const s = await getCachedSpecies(taxonId);
  if (!s) notFound();

  const t = await getTranslations("species");
  const nav = await getTranslations("nav");

  const lineage = [s.kingdom, s.phylum, s.class, s.order, s.family].filter(
    Boolean,
  ) as string[];
  // A 座標不開放 taxon has no rows in reports_public at all, so `reportCount` is
  // 0 even when records exist. Say that plainly rather than rendering a
  // misleading "no reports yet" — it reveals nothing a poacher can use, since
  // TaiCOL already publishes which species occur in Taiwan.
  const withheld = s.sensitivity === "座標不開放";
  // The blur the database gives this species' records, by every rule it has:
  // TaiCOL's rating, protection, the Red List, the species above a subspecies,
  // and our floors (0014, 0021). The notice used to appear only when TaiCOL's
  // sensitivity field was set, so a protected-but-unrated animal, a Red List
  // frog, or a subspecies under a rated species was blurred with no word of
  // it. Asked on the server's own connection because taxon_precision() reads
  // the floors table, which the public role may not; it answers one word.
  const [{ p: precision }] = await sql<{ p: string | null }[]>`
    select taxon_precision(${s.id}) as p`;
  const blurKm =
    precision === "coarse_50km" ? 50 : precision === "coarse_10km" ? 10 : null;
  const underReview = speciesNotes(s.taicolId).includes("nameUnderReview");
  const counts =
    s.reportCount >= HEATMAP_MIN_RECORDS ? await monthlyCounts(s.id) : null;
  const listed =
    !withheld && s.reportCount > 0 && s.reportCount <= LIST_MAX_RECORDS;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 pb-24 pt-10">
      <Link
        href="/species"
        className="inline-flex min-h-11 items-center text-sm font-medium text-leaf-700 underline underline-offset-2 hover:text-forest-900"
      >
        {nav("backToSpecies")}
      </Link>

      {/* The species name is this page's title, so it is set like one — the rest
          of the site moved to a 3xl h1 and this was left at 20px. */}
      <header className="mt-5">
        <h1 className="text-3xl font-semibold leading-tight text-ink-900">
          <SpeciesName
            species={s}
            locale={locale}
            author={s.nameAuthor}
            secondaryClassName="mt-2 text-base font-normal text-ink-600"
          />
        </h1>
        {s.altNamesZh && s.altNamesZh.length > 0 && (
          <p className="mt-1 text-sm text-ink-600">
            {t("alsoKnownAs")}: {s.altNamesZh.join("、")}
          </p>
        )}
        {underReview && (
          <p className="mt-3 rounded-lg border border-ink-900/15 bg-paper-100 px-3 py-2.5 text-sm leading-relaxed text-ink-700">
            {t("nameUnderReview")}
          </p>
        )}
        {/* Where it lives, as the same chips the card uses. It was a trailing
            clause on the lineage line — "· Terrestrial" — which is the one fact
            on this page a child would read first. */}
        <div className="mt-2.5">
          <HabitatChips species={s} />
        </div>
        {/* What protects it and how threatened it is, said in sentences. The
            chips that were here asked a reader to know four schemes first;
            lists and cards keep them. See SpeciesStatus. */}
        <SpeciesStatus {...s} />
      </header>

      {lineage.length > 0 && (
        <nav
          aria-label={t("taxonomy")}
          className="mt-4 text-sm text-ink-600"
        >
          {lineage.join(" › ")}
        </nav>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink-900">{t("records")}</h2>

        {withheld ? (
          <p className="mt-2 rounded-lg border border-amber-700/30 bg-amber-600/10 px-3 py-2.5 text-[12px] leading-relaxed text-amber-800">
            {t("coordinatesWithheld")}
          </p>
        ) : s.reportCount === 0 ? (
          // No "be the first" on a name nobody can file under: the report
          // form would open without it (see OFFERED in lib/species.ts).
          // The button itself is below, for every species anyone can file under.
          s.offered && (
            <p className="mt-2 text-sm text-ink-700">{t("noRecordsYet")}</p>
          )
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

            {blurKm && (
              <p className="mt-2 text-sm leading-relaxed text-ink-700">
                {t("blurredNotice", { km: blurKm })}{" "}
                <Link href="/about#blurred" className="text-leaf-700 underline underline-offset-2 hover:text-forest-900">
                  {t("blurredWhy")}
                </Link>
              </p>
            )}

            {listed && <SpeciesRecords taxonId={s.id} expected={s.reportCount} />}

            {counts && (
              <div className="mt-6">
                <MonthlyChart counts={counts} />
              </div>
            )}
          </>
        )}
      </section>

      {/* The page's one call to action, in the header's report orange with
          dark text (white on it is 3.4:1). It was a 12px outlined pill at the
          foot of the page. It opens the chooser with this species filled in,
          because the same animal can be a roadkill, an injured one or a
          sighting, and only the reporter knows which. */}
      {!withheld && s.offered && (
        <Link
          href={{ pathname: "/report", query: { taxonId: s.id } }}
          className="mt-8 flex min-h-12 w-full items-center justify-center bg-ember-500 px-5 py-3 text-center font-display text-[18px] font-bold uppercase tracking-[0.06em] text-ink-950 transition hover:bg-ember-400"
        >
          {s.reportCount > 0 ? t("seenOne") : t("beFirst")}
        </Link>
      )}
    </main>
  );
}
