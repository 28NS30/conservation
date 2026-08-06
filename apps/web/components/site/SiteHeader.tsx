import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Wordmark from "@/components/brand/Wordmark";
import LanguageSwitcher from "@/components/LanguageSwitcher";

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
}: {
  /**
   * `site`  — transparent, laid over the home hero.
   * `page`  — solid, in normal flow, for every inner page.
   * `app`   — compact strip above the full-screen map, carrying live counts.
   */
  variant?: "site" | "page" | "app";
  stats?: { reports: string; species: string; range: string | null };
}) {
  const t = await getTranslations();
  const app = variant === "app";
  const overlay = variant === "site";

  const nav = [
    { href: "/map", label: t("nav.map") },
    { href: "/species", label: t("nav.species") },
    { href: "/stats", label: t("nav.stats") },
    { href: "/about", label: t("nav.about") },
  ] as const;

  return (
    <header
      className={
        app
          ? "z-20 flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-parchment-200/10 bg-bark-900/95 px-4 py-2.5 backdrop-blur"
          : overlay
            ? "absolute inset-x-0 top-0 z-20"
            : "sticky top-0 z-20 border-b border-parchment-200/10 bg-bark-950/90 backdrop-blur"
      }
    >
      <div
        className={
          app
            ? "contents"
            : overlay
              ? "flex items-center justify-between gap-6 px-5 py-4 sm:px-8"
              : "mx-auto flex w-full max-w-5xl items-center justify-between gap-6 px-6 py-3"
        }
      >
        <Link href="/" className="shrink-0" aria-label={t("site.title")}>
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

          <nav className="hidden items-center gap-5 sm:flex">
            {nav.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-xs text-parchment-300 transition hover:text-parchment-50"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <LanguageSwitcher className="hidden sm:flex" />

          <Link
            href="/report"
            className="rounded-full bg-ember-500 px-4 py-1.5 text-xs font-semibold text-bark-950 transition hover:bg-ember-400"
          >
            + {t("nav.report")}
          </Link>
        </div>
      </div>

      {/* Phone navigation.
          The links above are hidden below `sm`, where the wordmark and the
          report button already fill a 390px row — which left the whole site
          reachable only from the footer. A second row costs one line of height
          and needs no menu button, no JS, and no focus trap. The map's own
          header stays single-row: there, vertical space is the instrument. */}
      {!app && (
        <div className="flex items-center justify-between gap-4 border-t border-parchment-200/10 px-5 py-2 sm:hidden">
          <nav className="flex items-center gap-5">
            {nav.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-xs text-parchment-300 transition hover:text-parchment-50"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <LanguageSwitcher />
        </div>
      )}
    </header>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="leading-tight">
      <div className="text-sm font-semibold tabular-nums text-parchment-50">
        {value}
      </div>
      <div className="text-[10px] text-parchment-400">{label}</div>
    </div>
  );
}
