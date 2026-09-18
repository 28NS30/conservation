import { getLocale, getTranslations } from "next-intl/server";
import { getLabCopy } from "@/lib/lab/copy";
import { Link } from "@/i18n/navigation";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import Button from "@/components/lab/ui/Button";
import Container from "@/components/lab/ui/Container";
import Emblem from "@/components/lab/ui/Emblem";
import { labPath, type LabDirection } from "@/lib/lab/directions";

/**
 * The forest band across the top (direction.md §4, "Shared chrome").
 *
 * 72px on a desktop, 56px above the map where the chrome is an instrument
 * panel, 56px on a phone. The mark is 48px and never smaller: below that the
 * badge's two rings of type turn to mud, and shrinking it is the mistake the
 * live header makes — `header-badge` in the review.
 *
 * Neither mark nor name on home. The home hero carries a 520px emblem and the
 * project's name at hero size forty pixels below; repeating both in a 48px bar
 * above it is how a page ends up saying its own name twice before it says
 * anything else.
 *
 * Nav uses the Filter underline, deliberately. "Which of these am I looking at"
 * is one question, and it should look like one question in the header, on the
 * map and on a species list.
 *
 * No nav on a phone: that is the bottom tab bar's job, and a row of five words
 * squeezed into a 56px band is the `map-mobile-nav` defect this replaces.
 */
export type LabNavKey = "map" | "species" | "stats" | "about";

export default async function LabHeader({
  direction,
  variant = "site",
  current,
}: {
  direction: LabDirection;
  /** `home` drops the mark and name; `map` drops 16px of band. */
  variant?: "site" | "home" | "map";
  current?: LabNavKey;
}) {
  const t = await getTranslations("nav");
  const site = await getTranslations("site");
  const copy = getLabCopy(await getLocale());

  const nav: { key: LabNavKey; href: string; label: string }[] = [
    { key: "map", href: labPath(direction, "/map"), label: t("map") },
    { key: "species", href: labPath(direction, "/species/28758"), label: t("species") },
    { key: "stats", href: "/stats", label: t("stats") },
    { key: "about", href: "/about", label: t("about") },
  ];

  return (
    <header data-surface="field" className="bg-(--ground) text-(--fg)">
      <Container>
        <div
          className={`flex items-center justify-between gap-6 ${
            variant === "map" ? "h-14" : "h-14 md:h-18"
          }`}
        >
          {variant === "home" ? (
            <span />
          ) : (
            <Link
              href={labPath(direction)}
              className="flex shrink-0 items-center gap-3"
              aria-label={site("title")}
            >
              <Emblem size={48} className="h-10 w-10 md:h-12 md:w-12" />
              <span className="t-lead hidden font-bold sm:block">
                {site("title")}
              </span>
            </Link>
          )}

          <nav
            aria-label={copy.common.nav}
            className="hidden items-end gap-6 md:flex"
          >
            {nav.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={current === item.key ? "page" : undefined}
                className="t-body -mb-1 inline-flex min-h-11 items-center border-b-4 text-(--fg)"
                style={{
                  borderBottomColor:
                    current === item.key ? "var(--accent-text)" : "transparent",
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-4">
            <LanguageSwitcher className="t-note" />
            <Button
              href={labPath(direction, "/report/stepper")}
              className="hidden md:inline-flex"
            >
              {t("report")}
            </Button>
          </div>
        </div>
      </Container>
    </header>
  );
}
