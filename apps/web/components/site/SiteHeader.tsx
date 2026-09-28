import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { REPORT_GROUPS } from "@conservation/shared";
import Wordmark from "@/components/brand/Wordmark";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import NavLink from "@/components/site/NavLink";
import ReportMenu from "@/components/site/ReportMenu";
import { currentUserId } from "@/lib/supabase/server";

/**
 * One header for the whole site, in the team's design.
 *
 * The brief took WWF's header as its reference — "on the top right instead are
 * the options for the report filing stuff and language swap", logo on the left
 * — and set the navigation bar in forest green. Taken as an idea, not copied:
 * the structure is theirs (a solid bar, bold blocks flush to the right edge),
 * the colours, type and wording are this site's.
 *
 * So the bar is forest green on every page, with light text; the orange block is
 * "File a report", which opens the three report types; the language switch is
 * the block beside it. Every pairing was measured before use: paper on forest
 * 10.98:1, parchment-200 nav on forest 7.0:1, dark text on the orange 6.1:1.
 *
 * `variant="app"` is the same bar above the full-screen map, not sticky, with
 * the live counts from `lg` up. Two things differ there, both on purpose:
 *   - its phone rows stay compact: every pixel of chrome is a pixel of Taiwan,
 *     and map-chrome.spec caps the whole header at 89px at 390;
 *   - it uses no web font. The map is the heaviest page and loads none today;
 *     perf.spec fails if it starts to. So its nav and report block are in the
 *     system face rather than the condensed display face.
 */
export default async function SiteHeader({
  variant = "page",
  stats,
}: {
  /**
   * `page` — sticky, for every page but the map.
   * `app`  — above the full-screen map, carrying live counts.
   * `site` — kept as an alias of `page` so no caller breaks; the transparent
   *          header it once meant floated over a home hero that no longer exists.
   */
  variant?: "site" | "page" | "app";
  stats?: { reports: string; species: string; range: string | null };
}) {
  const t = await getTranslations();
  // Only shown when there is something behind it. An always-visible "my reports"
  // that leads to a sign-in wall reads as a gate on a site whose whole promise
  // is that reporting needs no account.
  const signedIn = (await currentUserId()) !== null;
  const app = variant === "app";

  const nav = [
    { href: "/map", label: t("nav.map") },
    { href: "/species", label: t("nav.species") },
    { href: "/stats", label: t("nav.stats") },
    { href: "/about", label: t("nav.about") },
    ...(signedIn ? ([{ href: "/me", label: t("nav.mine") }] as const) : []),
  ] as const;

  // The three report types, each with its own category, so nothing is chosen
  // for the reporter. Labels and hints are the form's and the home page's own
  // strings, so the three places cannot describe the choices differently.
  // In the team's order, which is also the home page's: roadkill, invasive,
  // wildlife. (REPORT_GROUP_KEYS is the form's order, not this one.)
  const choices = (["roadkill", "invasive", "sighting"] as const).map((g) => ({
    href: `/report?category=${REPORT_GROUPS[g].categories[0]}`,
    label: t(`report.group.${g}`),
    hint: t(`home.door${g[0].toUpperCase()}${g.slice(1)}`),
  }));

  return (
    <header
      className={`z-30 bg-forest-900 text-paper-50 ${app ? "relative shrink-0" : "sticky top-0"}`}
    >
      <div
        className={`mx-auto flex max-w-[1280px] items-stretch justify-between ${
          app ? "h-12 md:h-14" : "h-14 md:h-[72px]"
        }`}
      >
        <Link
          href="/"
          aria-label={t("site.title")}
          className="flex shrink-0 items-center pl-4 pr-3 text-paper-50 sm:pl-6"
        >
          <Wordmark size="sm" className="sm:hidden" />
          <Wordmark size="md" className="hidden sm:flex" />
        </Link>

        <div className="flex min-w-0 items-stretch">
          {app && stats && (
            <div className="hidden items-center gap-5 pr-6 lg:flex">
              <Stat value={stats.reports} label={t("stats.records")} />
              <Stat value={stats.species} label={t("stats.species")} />
              {stats.range && <Stat value={stats.range} label={t("stats.range")} />}
            </div>
          )}

          <nav className="hidden items-center gap-6 pr-6 md:flex lg:gap-7">
            {nav.map((l) => (
              <NavLink key={l.href} href={l.href} label={l.label} overlay size={app ? "normal" : "large"} />
            ))}
          </nav>

          <ReportMenu label={t("nav.fileReport")} shortLabel={t("nav.report")} choices={choices} plain={app} />

          <div className="hidden items-center bg-forest-950 px-4 md:flex">
            <LanguageSwitcher size="md" className="text-paper-50" />
          </div>
        </div>
      </div>

      {/* Phone and small-tablet navigation: a second row rather than a menu
          button, so every section is one tap away with no script and no focus
          trap. On the map it stays compact (see above). The bottom tab bar in
          the plan replaces it. */}
      <div
        className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-forest-950 px-4 sm:px-6 md:hidden ${
          app ? "py-1.5" : "py-2"
        }`}
      >
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {nav.map((l) => (
            <NavLink
              key={l.href}
              href={l.href}
              label={l.label}
              overlay
              size={app ? "compact" : "normal"}
            />
          ))}
        </nav>
        {/* Compact on purpose: in English the links and "中文 / English" do
            not fit side by side at 375px at the larger size, and the switch
            wrapped onto a line of its own. */}
        <LanguageSwitcher className="text-parchment-100" />
      </div>
    </header>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="leading-tight">
      <div className="text-sm font-semibold tabular-nums text-paper-50">{value}</div>
      <div className="text-[11px] text-parchment-300">{label}</div>
    </div>
  );
}
