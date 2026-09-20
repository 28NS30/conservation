/**
 * What was actually measured, with the date and the command that measured it.
 *
 * The compare page makes claims — axe-clean, nothing under 14px, no font on
 * the map — and a claim on a decision page has to be checkable by the person
 * reading it. These are numbers rather than sentences so that they live in one
 * place instead of twice in two languages, and so that a figure that moves
 * moves everywhere at once.
 *
 * NOT computed at request time. Running Playwright inside a page render would
 * be absurd, and reading a results file would make the page's honesty depend on
 * whether somebody remembered to commit one. Transcribed by hand from the two
 * scripts' own output, with the command beside each block so the reader can run
 * it themselves and get the same answer:
 *
 *   node apps/web/e2e/lab/checks.mjs     — axe, type size, overflow, contrast
 *   node apps/web/e2e/lab/fonts.mjs      — font files and bytes per route
 *   node apps/web/e2e/lab/budgets.mjs    — tile requests and request kinds
 *
 * If these drift from what the scripts say, the scripts are right.
 */
export const VERIFIED = {
  /** The day all three were last run, against the dev server on this machine. */
  measuredOn: "2026-09-18",

  /* checks.mjs */
  routeWidthPairs: 128,
  textNodes: 9706,
  axeViolations: 0,
  textUnderFloor: 0,
  contrastFloor: 4.91,

  /* fonts.mjs — KB, one file each, preloaded on home only */
  homeFontKb: { roundel: 36.6, journal: 51.3 },
  mapFontFiles: 0,

  /* budgets.mjs — /api/tiles requests on the first view at 1440x900 */
  mapTiles: { lab: 4, live: 6 },
} as const;
