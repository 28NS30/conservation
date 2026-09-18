import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Wordmark from "@/components/brand/Wordmark";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import NavLink from "@/components/site/NavLink";
import { currentUserId } from "@/lib/supabase/server";

/**
 * One header for the whole site.
 *
 * `variant="app"` is the strip above the full-screen map: compact, opaque, and
 * carrying live counts, because there the header is chrome around an instrument.
 * `variant="site"` is the marketing header: taller, transparent over the hero, no
 * counts — the landing page states the numbers far more loudly further down, and
 * repeating them in 10px type undercuts that.
 */
export default async function SiteHeader({
  variant = "site",
  stats,
  wide = false,
}: {
  /**
   * `site`  — transparent, laid over the home hero.
   * `page`  — solid, in normal flow, for every inner page.
   * `app`   — compact strip above the full-screen map, carrying live counts.
   */
  variant?: "site" | "page" | "app";
  stats?: { reports: string; species: string; range: string | null };
  /**
   * Match the homepage's 1100px column. At max-w-5xl the logo in the header and
   * the badge below it started 38px apart on a desktop, which read as a mistake
   * right where the page is most looked at.
   */
  wide?: boolean;
}) {
  const t = await getTranslations();
  // Only shown when there is something behind it. An always-visible "my reports"
  // that leads to a sign-in wall reads as a gate on a site whose whole promise
  // is that reporting needs no account.
  const signedIn = (await currentUserId()) !== null;
  const app = variant === "app";
  const overlay = variant === "site";

  const nav = [
    { href: "/map", label: t("nav.map") },
    { href: "/species", label: t("nav.species") },
    { href: "/stats", label: t("nav.stats") },
    { href: "/about", label: t("nav.about") },
    ...(signedIn ? ([{ href: "/me", label: t("nav.mine") }] as const) : []),
  ] as const;

  return (
    <header
      // Marks this bar as sitting on the dark map, for the contrast audit —
      // it has no background of its own, so the DOM alone reads the light page
      // behind it.
      {...(overlay ? { "data-on-dark": "" } : {})}
      className={
        app
          ? "z-20 flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-ink-900/10 bg-paper-100/95 px-4 py-2.5 backdrop-blur"
          : overlay
            ? "absolute inset-x-0 top-0 z-20"
            : "sticky top-0 z-20 border-b border-ink-900/10 bg-paper-50/90 backdrop-blur"
      }
    >
      <div
        className={
          app
            ? "contents"
            : overlay
              ? "flex items-center justify-between gap-6 px-5 py-4 sm:px-8"
              : `mx-auto flex w-full ${wide ? "max-w-[1100px]" : "max-w-5xl"} items-center justify-between gap-3 px-4 py-3 sm:gap-6 sm:px-6`
        }
      >
        <Link
          href="/"
          className={`shrink-0 ${overlay ? "text-parchment-50" : "text-ink-900"}`}
          aria-label={t("site.title")}
        >
          <Wordmark size={app ? "sm" : "md"} />
        </Link>

        <div className="flex items-center gap-4 sm:gap-6">
          {app && stats && (
            <div className="hidden items-center gap-4 sm:flex">
              <Stat value={stats.reports} label={t("stats.records")} />
              <Stat value={stats.species} label={t("stats.species")} />
              {stats.range && (
                <Stat value={stats.range} label={t("stats.range")} />
              )}
            </div>
          )}

          {/* Inline from md, not sm, on every header but the map's. In
              English — Map, Species, Statistics, About, the language switch
              and the report button — this row needs about 660px, and at
              640px it pushed every page 21px sideways. */}
          <nav
            className={`hidden items-center gap-5 ${app ? "sm:flex" : "md:flex"}`}
          >
            {nav.map((l) => (
              <NavLink
                key={l.href}
                href={l.href}
                label={l.label}
                overlay={overlay}
              />
            ))}
          </nav>

          <LanguageSwitcher
            className={`hidden ${app ? "sm:flex" : "md:flex"} ${overlay ? "text-parchment-100" : "text-ink-700"}`}
          />

          <Link
            href="/report"
            className="rounded-full bg-ember-500 px-3 py-1.5 text-xs font-semibold text-bark-950 transition hover:bg-ember-400 sm:px-4"
          >
            + {t("nav.report")}
          </Link>
        </div>
      </div>

      {/* Phone and small-tablet navigation.
          The links above are hidden below `md` — below `sm` on the map — where
          the wordmark and the report button already fill a 390px row. A second
          row costs one line of height and needs no menu button, no JS, and no
          focus trap.

          The map used to be the exception, on the argument that there vertical
          space is the instrument. It is, and it was still the wrong call: /map
          is the page most visitors land on and the one that fills the viewport,
          so leaving it out made Species, Statistics and About reachable only by
          scrolling a page that does not scroll. Thirty-odd pixels of map is the
          cheaper loss. W3's tab bar replaces this row.

          In `variant="app"` the header itself is the wrapping flex container —
          the inner div is `contents` — so the row claims a line with
          `basis-full` and bleeds back out through the header's own padding
          instead of sitting inside it. */}
      <div
        className={
          app
            ? `-mx-4 -mb-2.5 flex basis-full items-center justify-between gap-4 border-t border-ink-900/10 px-4 py-1.5 sm:hidden`
            : `flex items-center justify-between gap-4 border-t px-4 py-2 sm:px-5 md:hidden ${
                overlay ? "border-parchment-200/15" : "border-ink-900/10"
              }`
        }
      >
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {nav.map((l) => (
            <NavLink
              key={l.href}
              href={l.href}
              label={l.label}
              overlay={overlay}
            />
          ))}
        </nav>
        <LanguageSwitcher
          className={overlay ? "text-parchment-100" : "text-ink-700"}
        />
      </div>
    </header>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="leading-tight">
      <div className="text-sm font-semibold tabular-nums text-ink-900">
        {value}
      </div>
      <div className="text-[10px] text-ink-500">{label}</div>
    </div>
  );
}
