import { SPECIES_DENSITY_CLASSES, densityClassMax } from "@conservation/shared";
import type { LabCopy } from "./copy";

/**
 * The decisions the species page makes about a name and a column of numbers.
 *
 * Pulled out of the page for one reason: every one of them is a rule from
 * direction.md that is easy to get subtly wrong and impossible to see going
 * wrong. "Six Hanzi or fewer" is a rule about Han characters, not about
 * `String.length` — 中國石龍子臺灣亞種 is nine characters and 9 * 40px is wider
 * than a 390px phone, so getting the count wrong is the difference between a
 * name that fills the page and a name that breaks it.
 */

/**
 * Han characters in a name, ignoring everything else.
 *
 * `length` counts UTF-16 code units, and `[...name]` counts code points; a name
 * carrying a Latin epithet, a middle dot or a space would inflate either. Only
 * the Hanzi decide how wide a Chinese name sets, so only the Hanzi are counted.
 */
export function hanziCount(name: string): number {
  let n = 0;
  for (const ch of name) if (/\p{Script=Han}/u.test(ch)) n += 1;
  return n;
}

/**
 * How big the name is, on a desktop and on a phone.
 *
 * direction.md §4: the Chinese name is `text-hero` at six Hanzi or fewer and
 * `text-display` above that; on a phone it is `text-display` and `text-title`
 * respectively. A Latin headline — which is what /en gets, because the data
 * holds no English common names — never takes the top step at all: 80px of
 * "Plestiodon chinensis formosensis" is three lines of a foreign word, and the
 * hero step exists for a name you can take in at a glance.
 */
export function nameSizes(name: string): {
  desktop: "hero" | "display";
  phone: "display" | "title";
} {
  const hanzi = hanziCount(name);
  if (hanzi === 0) return { desktop: "display", phone: "title" };
  return hanzi <= 6
    ? { desktop: "hero", phone: "display" }
    : { desktop: "display", phone: "title" };
}

/**
 * A taxon TaiCOL rates 座標不開放 has no rows in `reports_public` at all, so its
 * `reportCount` is 0 even when records exist.
 *
 * That has to be said out loud rather than rendered as "no reports yet", which
 * is the one sentence on this page that would be a lie. It reveals nothing a
 * poacher can use: TaiCOL already publishes which species occur in Taiwan and
 * which of them are withheld.
 */
export const WITHHELD = "座標不開放";

export function isWithheld(sensitivity: string | null): boolean {
  return sensitivity === WITHHELD;
}

/** The month with the most records, or null when there are none at all. */
export function peakMonth(counts: readonly number[]): number | null {
  let best = -1;
  let index: number | null = null;
  counts.forEach((n, i) => {
    if (n > best) {
      best = n;
      index = i;
    }
  });
  return best > 0 ? index : null;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? values[key] : whole,
  );
}

/**
 * The sentence that replaces a row of stat tiles.
 *
 * 2011–2017 年間有 3,978 筆紀錄，四月最多。 — one finding, at `text-head`, above
 * everything it is a finding about. A reader who looks at nothing else on the
 * page still leaves knowing the thing the page was built to say, which four
 * numbers in four boxes have never managed.
 *
 * Returns null when there is nothing true to say: no records, or no month with
 * any in it. An empty slot collapses (§2.6 rule 7) — it does not fall back to a
 * sentence about absence.
 */
export function findingSentence(
  copy: LabCopy,
  locale: string,
  s: { reportCount: number; firstSeen: string | null; lastSeen: string | null },
  counts: readonly number[],
): string | null {
  const peak = peakMonth(counts);
  if (s.reportCount <= 0 || peak === null || !s.firstSeen || !s.lastSeen)
    return null;
  return fill(copy.species.findingSentence, {
    from: String(new Date(s.firstSeen).getUTCFullYear()),
    to: String(new Date(s.lastSeen).getUTCFullYear()),
    count: s.reportCount.toLocaleString(locale),
    month: copy.species.monthNames[peak],
  });
}

/** "四月最多，共 729 筆。" — the chart's own finding, not the page's. */
export function chartFinding(
  copy: LabCopy,
  locale: string,
  counts: readonly number[],
): string | null {
  const peak = peakMonth(counts);
  if (peak === null) return null;
  return fill(copy.species.chartFinding, {
    month: copy.species.monthNames[peak],
    count: counts[peak].toLocaleString(locale),
  });
}

/** "這 3,978 筆紀錄落在這些地方。" — the map's. */
export function mapFinding(
  copy: LabCopy,
  locale: string,
  reportCount: number,
): string {
  return fill(copy.species.mapFinding, {
    count: reportCount.toLocaleString(locale),
  });
}

/** "通報黑眶蟾蜍" — the closing sign, which carries the taxon into the flow. */
export function reportThis(copy: LabCopy, name: string): string {
  return fill(copy.species.reportThis, { name });
}

/**
 * The lineage, in rank order, skipping ranks TaiCOL does not record.
 *
 * Genus is included and species is not: the species' own name is already the
 * largest thing on the page, and repeating it in a table under the heading
 * "分類" is the kind of completeness that makes a page longer without making it
 * say anything.
 */
export function lineageRows(
  copy: LabCopy,
  s: {
    kingdom: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
  },
): { rank: string; name: string; italic: boolean }[] {
  return (
    [
      ["kingdom", s.kingdom],
      ["phylum", s.phylum],
      ["class", s.class],
      ["order", s.order],
      ["family", s.family],
      ["genus", s.genus],
    ] as const
  )
    .filter(([, name]) => Boolean(name))
    .map(([key, name]) => ({
      rank: copy.species.rank[key],
      name: name!,
      // A genus is italicised and every rank above it is not. Getting that
      // wrong is the sort of thing the researchers this site is partly for
      // notice in the first second.
      italic: key === "genus",
    }));
}

/**
 * Which ramp step each density class takes on a SPECIES map.
 *
 * Two decisions live in this one array, and both are corrections rather than
 * taste.
 *
 * The BREAKS are `SPECIES_DENSITY_CLASSES` (1, 2, 5, 15, 40), not the corpus's
 * `DENSITY_CLASSES` (1, 3, 10, 30, 100, 300). Even the most-reported taxon holds
 * a few thousand records against the corpus's 46k, so almost every one of its
 * cells holds one or two: run through the corpus breaks, a species map is one
 * flat colour and says nothing. That is `packages/shared`'s own reasoning, and
 * it is why that second array exists.
 *
 * The STEPS start at 2, not 1. Ramp step 1 is deliberately the dimmest class,
 * because on the whole-country map most cells hold a single report and a bright
 * lowest class turns the island into noise. On one species the opposite is
 * true — a single record IS the signal — so the scale starts a step up, at
 * 4.39:1 against the forest land rather than 3.36:1, and the top class is still
 * the brightest the ramp has.
 *
 * There are five classes and six ramp steps. That is not an oversight: the
 * legend below is generated from this array, so it can only ever show the
 * classes the map actually paints.
 */
export const SPECIES_RAMP_STEPS = [2, 3, 4, 5, 6] as const;

export type RampStep = 1 | 2 | 3 | 4 | 5 | 6;

/** `[{ min, ramp }]`, in class order — the paint expression's input. */
export function speciesDensitySteps(): { min: number; ramp: RampStep }[] {
  return SPECIES_DENSITY_CLASSES.map((c, i) => ({
    min: c.min,
    ramp: SPECIES_RAMP_STEPS[i] as RampStep,
  }));
}

/**
 * The legend, generated from the same array the paint expression reads.
 *
 * Break numbers only — digits, no unit and no word, because the Legend's own
 * caption carries the unit and twelve characters of Chinese under a 40px swatch
 * would be under the 14px floor or wrapped to three lines.
 */
export function speciesLegendItems(): { ramp: RampStep; label: string }[] {
  return speciesDensitySteps().map((step, i) => {
    const max = densityClassMax(i, SPECIES_DENSITY_CLASSES);
    return {
      ramp: step.ramp,
      label:
        max === null
          ? `${step.min}+`
          : max === step.min
            ? `${step.min}`
            : `${step.min}–${max}`,
    };
  });
}
