import type { ReportPage } from "@conservation/shared";

/**
 * Which of the home page's three report rows describes each report page.
 *
 * The chooser at /report, the pages themselves and the home page all describe
 * the three kinds of report, and they describe them in the same words — the
 * home page's `home.row*Title`, `home.row*Body` and `home.row*Cta` — so the
 * three places cannot disagree about what each one is for. The header's menu
 * uses the matching `report.group.*` label and `home.door*` hint.
 *
 * The wildlife page's row is still called "Sighting" in the catalogue, as the
 * stored category is: renaming a message key is churn for every translator
 * and buys nothing a reader sees.
 */
export const ROW_KEY = {
  roadkill: "Roadkill",
  invasive: "Invasive",
  wildlife: "Sighting",
} as const satisfies Record<ReportPage, string>;

/** The address of a report page, carrying the species a link arrived with. */
export function reportPageHref(page: ReportPage, taxonId?: number | null): string {
  return taxonId ? `/report/${page}?taxonId=${taxonId}` : `/report/${page}`;
}
