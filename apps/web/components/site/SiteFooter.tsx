import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Wordmark from "@/components/brand/Wordmark";
import LanguageSwitcher from "@/components/LanguageSwitcher";

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
  obscured?: string;
}) {
  const t = await getTranslations();

  const sources = (
    <>
      {t("footer.dataSource")}:{" "}
      <ExternalLink href="https://roadkill.tw">TaiRON</ExternalLink> via{" "}
      <ExternalLink href="https://www.gbif.org">GBIF</ExternalLink> (CC BY 4.0) ·{" "}
      {t("footer.checklist")} <ExternalLink href="https://taicol.tw">TaiCOL</ExternalLink>
      {obscured && <> · {t("footer.blurredCount", { count: obscured })}</>}
    </>
  );

  const legal = [
    { href: "/about", label: t("nav.about") },
    { href: "/attribution", label: t("nav.attribution") },
    { href: "/privacy", label: t("nav.privacy") },
  ] as const;

  if (variant === "app") {
    return (
      <footer className="z-20 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-ink-900/10 bg-paper-100/95 px-4 py-1.5 text-[10px] text-ink-500">
        <span>{sources}</span>
        <span className="flex items-center gap-3">
          {legal.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-ink-800">
              {l.label}
            </Link>
          ))}
          <LanguageSwitcher className="sm:hidden" />
        </span>
      </footer>
    );
  }

  return (
    <footer className="border-t border-ink-900/10 bg-paper-100">
      <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-12 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Wordmark size="md" />
          <p className="mt-4 max-w-xs text-xs leading-relaxed text-ink-500">
            {t("site.description")}
          </p>
        </div>

        <nav aria-label={t("footer.explore")}>
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-ink-600">
            {t("footer.explore")}
          </h2>
          <ul className="mt-3 space-y-2 text-xs text-ink-500">
            {[
              { href: "/map", label: t("nav.map") },
              { href: "/species", label: t("nav.species") },
              { href: "/stats", label: t("nav.stats") },
              { href: "/reports", label: t("list.title") },
            ].map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="transition hover:text-ink-900">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label={t("footer.about")}>
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-ink-600">
            {t("footer.about")}
          </h2>
          <ul className="mt-3 space-y-2 text-xs text-ink-500">
            {legal.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="transition hover:text-ink-900">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <LanguageSwitcher />
          </div>
        </nav>
      </div>

      <div className="border-t border-ink-900/10">
        <p className="mx-auto max-w-5xl px-6 py-4 text-[11px] leading-relaxed text-ink-500">
          {sources}
        </p>
      </div>
    </footer>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      className="text-ink-600 underline-offset-2 hover:underline"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  );
}
