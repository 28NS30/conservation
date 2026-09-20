import manifest from "@/public/lab/shots/manifest.json";
import type { Locale } from "@/i18n/routing";
import type { LabDirection } from "./directions";

/**
 * The screenshot matrix, as the compare page sees it.
 *
 * `e2e/lab/shots.mjs` writes `public/lab/shots/manifest.json` in the same run
 * that writes the pictures, and this types it. Importing the manifest rather
 * than composing filenames is the whole point: a page that builds its own
 * `src` strings renders a grid of broken images the day a route is renamed,
 * and it does it silently, because a missing `<img>` is a layout with a gap in
 * it rather than an error. Here a shot that was never taken is `undefined` and
 * the card says so.
 *
 * The manifest is committed. It has to be: it is imported at build time, and a
 * build that depended on somebody having run Playwright first would fail on
 * Vercel and nowhere else.
 */
export type ShotCut = "fold" | "full";

export type LabShot = {
  file: string;
  /** The row it belongs to: "home", "map", "report", "species-28758", … */
  page: string;
  /** The column: "today", a direction, or a direction and a flow. */
  variant: string;
  direction: LabDirection | null;
  flow: string | null;
  locale: string;
  viewport: number;
  cut: ShotCut;
  /** The route this is a picture of, unprefixed — next-intl adds the locale. */
  href: string;
  width: number;
  height: number;
  bytes: number;
};

export const LAB_SHOTS = manifest.shots as LabShot[];

/** Where the files are served from. Not `withBase()`'d here; callers do that. */
export const SHOTS_DIR = "/lab/shots";

export function findShot(
  page: string,
  variant: string,
  locale: Locale,
  viewport: number,
  cut: ShotCut = "fold",
): LabShot | undefined {
  return LAB_SHOTS.find(
    (shot) =>
      shot.page === page &&
      shot.variant === variant &&
      shot.locale === locale &&
      shot.viewport === viewport &&
      shot.cut === cut,
  );
}

/**
 * The columns of a row, in the order they are read.
 *
 * Today first, because it is what the others are being measured against and a
 * reader's eye starts at the left. Then the recommendation, then the runner-up:
 * the review ranks them, and a page that puts them in whatever order the
 * filenames sort in argues for a different recommendation than the document
 * does. Left to the manifest's own order, "journal" came before "roundel" and
 * "photo-first" before "stepper", both backwards.
 */
function rank(shot: { variant: string; direction: LabDirection | null; flow: string | null }) {
  if (shot.variant === "today") return 0;
  const byDirection = shot.direction === "roundel" ? 1 : 2;
  const byFlow = shot.flow === "photo-first" ? 1 : 0;
  return byDirection * 10 + byFlow;
}

export function shotsFor(page: string, locale: Locale, viewport: number) {
  const seen = new Set<string>();
  const columns: LabShot[] = [];
  for (const shot of LAB_SHOTS) {
    if (shot.page !== page || shot.locale !== locale || shot.cut !== "fold")
      continue;
    if (seen.has(shot.variant)) continue;
    seen.add(shot.variant);
    columns.push(shot);
  }
  const variants = columns.sort((a, b) => rank(a) - rank(b)).map((s) => s.variant);
  return variants.map((variant) => ({
    variant,
    fold: findShot(page, variant, locale, viewport, "fold"),
    href: LAB_SHOTS.find(
      (shot) => shot.page === page && shot.variant === variant,
    )?.href,
  }));
}
