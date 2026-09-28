import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { sql } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { REPORT_GROUPS, type ReportGroup } from "@conservation/shared";
import { mapEntrySpecies, recordedSpeciesCount } from "@/lib/stats";
import { PHOTOS, HERO, type PhotoKey } from "@/lib/home/photos";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import HeroSlideshow from "@/components/home/HeroSlideshow";
import StoryRow, { SectionTitle } from "@/components/home/StoryRow";

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

type Stats = { species: number; obscured: string };

/**
 * The species figure is recordedSpeciesCount(), the one definition every other
 * page uses. This page counted `distinct taxon_id` on its own and said 506
 * while /species, /stats, /map and /season said 501: the five in between are
 * records filed under names that do not apply in Taiwan, which the directory
 * hides. A number the reader cannot reproduce by opening the directory is one
 * they stop trusting.
 */
async function getStats(): Promise<Stats> {
  const [[row], species] = await Promise.all([
    sql<{ obscured: string }[]>`
      select count(*) filter (where is_obscured)::text as obscured
        from reports_public`,
    recordedSpeciesCount(),
  ]);
  return { species, obscured: row.obscured };
}

/**
 * Places a reader might start the map from. Each opens on a view that has
 * records in it; home.test checks that against the public view, so a place
 * that stopped having any would fail rather than open on an empty map.
 */
const MAP_PLACES = [
  { key: "yangmingshan", lng: 121.55, lat: 25.17 },
  { key: "taichung", lng: 120.68, lat: 24.15 },
  { key: "hualien", lng: 121.6, lat: 23.98 },
  { key: "kenting", lng: 120.8, lat: 21.95 },
] as const;

/**
 * One photograph row per report type. Roadkill first: it is what the project
 * began as and still what most of its records are. Each links to the form with
 * its own category, so nothing is chosen for the reporter.
 */
const REPORT_ROWS: {
  group: ReportGroup;
  photo: PhotoKey;
  key: "Roadkill" | "Invasive" | "Sighting";
}[] = [
  { group: "roadkill", photo: "forestRoad", key: "Roadkill" },
  { group: "invasive", photo: "iguana", key: "Invasive" },
  { group: "sighting", photo: "treeFrog", key: "Sighting" },
];

/**
 * The front page, in the team's design (September 2026).
 *
 * THE BRIEF, AND HOW IT WAS READ. Two references, with the team's own caveat
 * that "copy this format" means do something like it, never the same:
 *
 * - WWF's hero: a statement on one side and a large photograph on the other,
 *   with the logo up in the header. Here the photograph rotates, as the team
 *   asked ("cycling images of us and animals"). Until there are photos of the
 *   team, it is Taiwan's animals, each credited on the image.
 * - National Geographic's long scroll: a centred section title with a short
 *   rule, then big photographs alternating side to side with a headline and two
 *   sentences each. That is both sections below the hero.
 *
 * The palette is theirs: ivory, forest green, leaf green, warm orange, black
 * body text.
 *
 * WHAT WENT, AND WHERE. The large badge is now the logo in the header. The dark
 * data-source strip, the "this week in other years" ledger (whose "recent"
 * records were from 2017), how-it-works and the open-data note are gone from
 * this page. TaiRON is still credited here, in the "who runs it" row, and in the
 * footer and on /attribution — the data is CC BY 4.0, which requires it. The
 * promise about blurred locations stays on the page, in the map row.
 *
 * WHAT STAYED ON PURPOSE. The ways into the map by animal: three animals that are
 * common, named, and never sensitive or protected, which home.test checks
 * against the database. A front-page button leading straight to where a
 * sensitive animal lives would be a strange thing to build, blurred or not.
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
  const [s, entrySpecies] = await Promise.all([getStats(), mapEntrySpecies(3)]);
  const zh = locale.startsWith("zh");
  const photoBy = t("photoBy");

  const slides = HERO.map((k) => {
    const p = PHOTOS[k];
    return {
      src: p.src,
      alt: zh ? p.alt.zh : p.alt.en,
      name: zh ? p.name.zh : p.name.en,
      author: p.author,
      license: p.license,
      licenseUrl: p.licenseUrl,
      source: p.source,
    };
  });

  const chip =
    "inline-flex min-h-9 items-center rounded-full border border-parchment-200/35 px-3.5 text-[14px] text-paper-50 transition hover:border-paper-50 hover:bg-paper-50/10";

  return (
    <main className="bg-paper-50">
      <SiteHeader variant="page" />

      {/* ---------------- hero ---------------- */}
      <section aria-labelledby="hero-title" className="bg-forest-900 text-paper-50">
        <div className="mx-auto grid max-w-[1280px] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12 lg:px-6 lg:py-12">
          <div className="@container order-2 flex flex-col justify-center px-5 pb-12 pt-8 sm:px-8 lg:order-1 lg:px-0 lg:py-4">
            <span aria-hidden className="block h-1.5 w-20 bg-ember-500" />
            <p className="mt-6 font-display text-[15px] font-semibold uppercase tracking-[0.14em] text-parchment-200">
              <span lang="zh-TW">福爾摩沙守望計畫</span>
              <span aria-hidden>{" · "}</span>
              <span lang="en">Project FormosaWatch</span>
            </p>
            {/* Sized to the COLUMN (cqw), not the window. Each phrase is bound
                so it never breaks inside itself, which only works if the longest
                phrase fits the column: "TAIWAN'S WILDLIFE," and 為臺灣的野生動物
                are about eight times the font size wide. Sized to the window,
                they overflowed the ~480px desktop column and wrapped anyway. */}
            <h1
              id="hero-title"
              className={`mt-3 font-display font-bold leading-[0.98] text-paper-50 [text-wrap:balance] ${
                zh
                  ? "text-[min(11cqw,3.7rem)] tracking-[0.02em]"
                  : "text-[min(11.5cqw,3.7rem)] uppercase"
              }`}
            >
              {/* Each phrase is unbreakable, so a wrap can only fall between them:
                  never "WILDLIFE, ON / THE RECORD" or 野生 / 動物. */}
              {t.rich("heroTitle", { ph: (c) => <span className="inline-block">{c}</span> })}
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-paper-50/90 sm:text-lg">
              {t("heroBody")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {/* To the three report types below rather than to the form: the
                  form preselects "roadkill, dead" when opened without a type. */}
              <a
                href="#file-a-report"
                className="inline-flex min-h-12 items-center bg-ember-500 px-6 font-display text-[18px] font-bold uppercase tracking-[0.06em] text-ink-950 transition hover:bg-ember-400"
              >
                {t("ask")}
              </a>
              <Link
                href="/map"
                className="inline-flex min-h-12 items-center border-2 border-paper-50/70 px-6 font-display text-[18px] font-semibold uppercase tracking-[0.06em] text-paper-50 transition hover:border-paper-50 hover:bg-paper-50/10"
              >
                {t("heroExplore")}
              </Link>
            </div>
          </div>

          <div className="relative order-1 aspect-[3/2] w-full lg:order-2 lg:aspect-auto lg:min-h-[540px]">
            <HeroSlideshow
              slides={slides}
              sizes="(min-width: 1280px) 720px, (min-width: 1024px) 58vw, 100vw"
              labels={{
                region: t("slideshowLabel"),
                pause: t("slideshowPause"),
                play: t("slideshowPlay"),
                // Raw: the slideshow fills {n} and {total} itself, per slide.
                goTo: t.raw("slideshowGoTo") as string,
                slide: t.raw("slideshowSlide") as string,
                photoBy,
              }}
            />
          </div>
        </div>
      </section>

      {/* ---------------- file a report ---------------- */}
      <section
        id="file-a-report"
        aria-labelledby="file-title"
        className="scroll-mt-28 px-5 py-16 sm:px-8 sm:py-24"
      >
        <SectionTitle id="file-title" title={t("ask")} hint={t("askHint")} zh={zh} />
        <div className="mx-auto mt-14 grid max-w-[1200px] gap-16 sm:mt-16 sm:gap-24">
          {REPORT_ROWS.map((r, i) => (
            <StoryRow
              key={r.group}
              photo={PHOTOS[r.photo]}
              zh={zh}
              photoBy={photoBy}
              title={t(`row${r.key}Title`)}
              body={t(`row${r.key}Body`)}
              cta={t(`row${r.key}Cta`)}
              href={`/report?category=${REPORT_GROUPS[r.group].categories[0]}`}
              reverse={i % 2 === 1}
            />
          ))}
        </div>
      </section>

      {/* ---------------- explore ---------------- */}
      <section
        aria-labelledby="explore-title"
        className="bg-forest-900 px-5 py-16 text-paper-50 sm:px-8 sm:py-24"
      >
        <SectionTitle
          id="explore-title"
          tone="dark"
          title={t("exploreTitle")}
          hint={t("exploreHint")}
          zh={zh}
        />
        <div className="mx-auto mt-14 grid max-w-[1200px] gap-16 sm:mt-16 sm:gap-24">
          <StoryRow
            tone="dark"
            photo={PHOTOS.mountains}
            zh={zh}
            photoBy={photoBy}
            title={t("mapKicker")}
            body={
              <>
                {t.rich("mapLine", { ph: (c) => <span className="inline-block">{c}</span> })}{" "}
                {t("mapPrivacy")}
              </>
            }
            cta={t("ctaMap")}
            href="/map"
          >
            <dl className="mt-6 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[auto_1fr] sm:items-baseline">
              <dt className="text-parchment-300">{t("mapSpeciesLabel")}</dt>
              <dd>
                <ul className="flex flex-wrap gap-2">
                  {entrySpecies.map((sp) => (
                    <li key={sp.id}>
                      <Link href={`/map?taxonId=${sp.id}`} className={`${chip} ${zh ? "" : "italic"}`}>
                        {zh ? sp.commonNameZh : sp.scientificName}
                      </Link>
                    </li>
                  ))}
                </ul>
              </dd>
              <dt className="text-parchment-300">{t("mapPlacesLabel")}</dt>
              <dd>
                <ul className="flex flex-wrap gap-2">
                  {MAP_PLACES.map((pl) => (
                    <li key={pl.key}>
                      <Link href={`/map?lng=${pl.lng}&lat=${pl.lat}&z=11`} className={chip}>
                        {t(`places.${pl.key}`)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </dd>
            </dl>
          </StoryRow>

          <StoryRow
            tone="dark"
            reverse
            photo={PHOTOS.mikado}
            zh={zh}
            photoBy={photoBy}
            title={t("speciesTitle", { count: s.species })}
            body={t("speciesBody")}
            cta={t("speciesLink")}
            href="/species"
          />

          {/* Taiwan's animals stand in here too, until the team has photographs
              of itself to put in this row and in the rotating hero. */}
          <StoryRow
            tone="dark"
            photo={PHOTOS.macaque}
            zh={zh}
            photoBy={photoBy}
            title={t("whoTitle")}
            body={t("whoBody")}
            cta={t("trustLink")}
            href="/about"
          >
            {/* The credit TaiRON's CC BY 4.0 licence requires, as its own
                paragraph rather than run on from the team's description. */}
            <p className="mt-4 max-w-[34rem] text-[15px] leading-relaxed text-parchment-200">
              {t("taironBody")}
            </p>
          </StoryRow>
        </div>
      </section>

      <SiteFooter obscured={s.obscured} />
    </main>
  );
}
