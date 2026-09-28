import { getTranslations } from "next-intl/server";
import { teamPublished } from "@/lib/team";
import { Link } from "@/i18n/navigation";
import Wordmark from "@/components/brand/Wordmark";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { seasonOpen } from "@/lib/coverage";

/**
 * One footer for the whole site.
 *
 * `variant="app"` is the single thin line under the map, where vertical space is
 * the map's and attribution is a legal obligation rather than a design element.
 * `variant="site"` is the real footer.
 *
 * The attribution is not boilerplate: the seed records are CC BY 4.0, so naming
 * TaiRON and GBIF is a licence condition, not a courtesy.
 */
export default async function SiteFooter({
  variant = "site",
  obscured,
}: {
  variant?: "site" | "app";
  /**
   * How many public records are blurred. A number, formatted here: the home
   * page passed its SQL count through as the string "7169" and the map passed
   * "7,169", so the same footer printed the same count two ways.
   */
  obscured?: number | string;
}) {
  const [t, seasonIsOpen] = await Promise.all([getTranslations(), seasonOpen()]);
  const blurred = Number(obscured);

  // One message rather than words glued around links. The glue was English —
  // "TaiRON via GBIF" sat in the middle of the Chinese footer on every page.
  const sources = (
    <>
      {t.rich("footer.sources", {
        tairon: (c) => <ExternalLink href="https://roadkill.tw">{c}</ExternalLink>,
        gbif: (c) => <ExternalLink href="https://www.gbif.org">{c}</ExternalLink>,
        taicol: (c) => <ExternalLink href="https://taicol.tw">{c}</ExternalLink>,
      })}
      {blurred > 0 && <> · {t("footer.blurredCount", { count: blurred })}</>}
    </>
  );

  const legal = [
    { href: "/about", label: t("nav.about") },
    // Only once there are real people on it; see lib/team.ts. An empty team
    // page says something worse about a project than no team page at all.
    ...(teamPublished()
      ? ([{ href: "/team", label: t("nav.team") }] as const)
      : []),
    { href: "/attribution", label: t("nav.attribution") },
    { href: "/privacy", label: t("nav.privacy") },
  ] as const;

  // Both footers carry it, including the thin strip under the map. 個資法 gives
  // people the right to have their data removed, and /map is the page most
  // visitors see — a right reachable from everywhere except the busiest page is
  // not reachable from everywhere.
  const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "neolava2@gmail.com";

  if (variant === "app") {
    return (
      <footer className="z-20 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-ink-900/10 bg-paper-100/95 px-4 py-1.5 text-xs text-ink-600">
        <span>{sources}</span>
        <span className="flex items-center gap-3">
          {legal.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-ink-800">
              {l.label}
            </Link>
          ))}
          <a href={`mailto:${contact}`} className="hover:text-ink-800">
            {t("nav.contact")}
          </a>
        </span>
      </footer>
    );
  }

  // The header's forest green again, so the page is bracketed by the team's
  // colour rather than ending in grey small print. Every pairing measured:
  // paper-50 on forest-950 13.9:1, parchment-200 9.3:1, parchment-300 6.6:1.
  // Links sit in a 32px row so a thumb can hit them.
  const link = "inline-flex min-h-8 items-center text-paper-50 underline-offset-4 transition hover:underline";
  return (
    <footer className="bg-forest-950 text-paper-50">
      <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-12 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Wordmark size="md" />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-parchment-200">
            {t("site.description")}
          </p>
        </div>

        <nav aria-label={t("footer.explore")}>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-parchment-300">
            {t("footer.explore")}
          </h2>
          <ul className="mt-3 space-y-1 text-sm">
            {[
              { href: "/map", label: t("nav.map") },
              { href: "/species", label: t("nav.species") },
              { href: "/stats", label: t("nav.stats") },
              // Only once somebody has filed a report: see seasonOpen().
              ...(seasonIsOpen ? [{ href: "/season", label: t("nav.season") }] : []),
              { href: "/reports", label: t("list.title") },
            ].map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={link}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label={t("footer.about")}>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-parchment-300">
            {t("footer.about")}
          </h2>
          <ul className="mt-3 space-y-1 text-sm">
            {legal.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={link}>
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <a href={`mailto:${contact}`} className={link}>
                {t("nav.contact")}
              </a>
            </li>
          </ul>
          <div className="mt-4">
            <LanguageSwitcher size="md" className="text-parchment-100" />
          </div>
        </nav>
      </div>

      <div className="border-t border-paper-50/15">
        <p className="mx-auto max-w-5xl px-6 py-5 text-xs leading-relaxed text-parchment-200">
          {sources}
        </p>
      </div>
    </footer>
  );
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    // Its footer's colour, not its own: the same links sit on ivory under the
    // map and on forest green at the foot of every other page.
    <a
      className="underline underline-offset-2 hover:opacity-80"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}
