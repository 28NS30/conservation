import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import LabFontPreload from "@/components/lab/chrome/LabFontPreload";
import LabFooter from "@/components/lab/chrome/LabFooter";
import LabHeader from "@/components/lab/chrome/LabHeader";
import LabTabBar from "@/components/lab/chrome/LabTabBar";
import HomeHero from "@/components/lab/home/HomeHero";
import HomeLedger from "@/components/lab/home/HomeLedger";
import HomeWaysIn from "@/components/lab/home/HomeWaysIn";
import LinkAction from "@/components/lab/ui/LinkAction";
import Section from "@/components/lab/ui/Section";
import { getLabCopy } from "@/lib/lab/copy";
import { isLabDirection, type LabDirection } from "@/lib/lab/directions";
import { anniversaryLedger, mapEntrySpecies } from "@/lib/stats";

/** Same as the live home page: the ledger changes by the day, not the second. */
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; direction: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return { title: getLabCopy(locale).lab.pageHome };
}

/**
 * The page the owner has rejected twice, in whichever direction the URL names.
 *
 * ONE PAGE, TWO LOOKS. Both directions render this file: the same blocks in the
 * same order with the same data and the same words, so a difference the owner
 * sees is a difference in the design and not in the content. That is the whole
 * design of the lab — a losing direction costs a CSS file, not a rebuild — and
 * home is where it has to hold hardest, because home is the page that settles
 * taste and the comparison is worthless if the two are not the same page.
 *
 * WHAT A DIRECTION IS ALLOWED TO CHANGE is the table below and nothing else.
 * Roundel (direction.md §4) separates its blocks with full-bleed grounds: a
 * forest band at the top, a cream plate under the emblem, a forest block for
 * the map, paper for the rest. The Field journal (§3) has no blocks at all —
 * "nothing is boxed except inputs, maps and pictures" — so every one of those
 * grounds is the same sheet, the sections are opened by a 2px rule with the
 * heading out in the left margin, and the single tinted band the direction
 * allows itself goes on the block that is a list of destinations. Everything
 * else about the two is a theme file.
 *
 * THE STRUCTURE, top to bottom: hero, then the three blocks §4 names — ways
 * into the map with no picture of the map, five records from this week in other
 * years, one sentence crediting the volunteers who collected them. No count, no
 * doors, no question, no data-art. The how-it-works, blurring and open-data
 * copy the rejected versions carried moved to /about.
 */
const COMPOSITION = {
  roundel: {
    chrome: "field",
    hero: "plate",
    waysIn: "field",
    ledger: "paper",
    credit: "paper",
    heading: "block",
  },
  journal: {
    chrome: "paper",
    hero: "paper",
    // The one tinted band this direction allows itself per page, spent on the
    // block that is a list of places to go rather than a paragraph to read.
    waysIn: "plate",
    ledger: "paper",
    credit: "paper",
    heading: "margin",
  },
} as const satisfies Record<
  LabDirection,
  {
    chrome: "paper" | "plate" | "field";
    hero: "paper" | "plate" | "field";
    waysIn: "paper" | "plate" | "field";
    ledger: "paper" | "plate" | "field";
    credit: "paper" | "plate" | "field";
    heading: "block" | "margin";
  }
>;

export default async function LabDirectionHome({
  params,
}: {
  params: Promise<{ locale: string; direction: string }>;
}) {
  const { locale, direction } = await params;
  setRequestLocale(locale);
  if (!isLabDirection(direction)) return null;

  const look = COMPOSITION[direction];
  const copy = getLabCopy(locale);
  // Both read `reports_public` through `asPublic`, so the blurring of sensitive
  // locations is inherited rather than re-implemented. The lab never touches
  // the `reports` table and never writes.
  const [ledger, species] = await Promise.all([
    anniversaryLedger(5),
    mapEntrySpecies(3),
  ]);

  return (
    <>
      {/* Home is the only route that preloads a face: the typeface IS the first
          impression here, and a preload on a layout would put a font request on
          the map. See components/lab/chrome/LabFontPreload.tsx. */}
      <LabFontPreload direction={direction} />
      <LabHeader direction={direction} variant="home" surface={look.chrome} />
      <main className="lab-page-bottom flex-1">
        <HomeHero direction={direction} locale={locale} surface={look.hero} />
        <HomeWaysIn
          direction={direction}
          locale={locale}
          surface={look.waysIn}
          heading={look.heading}
          species={species}
        />
        <HomeLedger
          locale={locale}
          surface={look.ledger}
          heading={look.heading}
          rows={ledger}
        />
        {/* The third block: one sentence, at `head`, saying whose records these
            are, and one way to read the rest of that story rather than the page
            telling it here. It has no heading — a heading above a single
            sentence is a sentence said twice — so `Section` draws the rule and
            leaves the measure alone in either placement. */}
        <Section surface={look.credit} heading={look.heading} className="py-16">
          <p className="t-head max-w-(--container-prose) text-(--fg)">
            {copy.home.creditSentence}
          </p>
          <p className="mt-6">
            <LinkAction href="/about" standalone arrow>
              {copy.home.creditLink}
            </LinkAction>
          </p>
        </Section>
      </main>
      <LabFooter direction={direction} />
      <LabTabBar
        direction={direction}
        surface={look.chrome}
        reportVariant="outline"
      />
    </>
  );
}
