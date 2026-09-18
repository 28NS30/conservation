import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getLabCopy } from "@/lib/lab/copy";
import { labPath, type LabDirection } from "@/lib/lab/directions";

/**
 * The phone's navigation: fixed, five items, thumb-height.
 *
 * 64px plus the safe area, forest, server-rendered links — no client module, so
 * it costs the map nothing. The middle item is the report action as a raised
 * ember block, because on a phone this bar is the only place a reporter can
 * reach with one hand while standing at a roadside.
 *
 * On home that block is outlined instead of filled: the hero already carries
 * the one ember sign, and two ember rectangles in a viewport is the rule this
 * design is built on (§2.6 rule 1). On /report the bar is not rendered at all —
 * the flow owns the screen.
 */
export default async function LabTabBar({
  direction,
  current,
  reportVariant = "primary",
}: {
  direction: LabDirection;
  current?: "map" | "species" | "report" | "stats" | "about";
  /** `outline` on home, where the hero is already the ember element. */
  reportVariant?: "primary" | "outline";
}) {
  const t = await getTranslations("nav");
  const copy = getLabCopy(await getLocale());

  const items = [
    { key: "map" as const, href: labPath(direction, "/map"), label: t("map") },
    {
      key: "species" as const,
      href: labPath(direction, "/species/28758"),
      label: t("species"),
    },
    {
      key: "report" as const,
      href: labPath(direction, "/report/stepper"),
      label: t("report"),
    },
    { key: "stats" as const, href: "/stats", label: t("stats") },
    { key: "about" as const, href: "/about", label: t("about") },
  ];

  return (
    <nav
      data-surface="field"
      aria-label={copy.common.nav}
      className="lab-tabbar fixed inset-x-0 bottom-0 z-40 bg-(--ground) text-(--fg) md:hidden"
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const isReport = item.key === "report";
          const base =
            "flex flex-col items-center justify-center gap-1 text-center";
          const shape = isReport
            ? `${base} m-2 h-12 ${
                reportVariant === "primary"
                  ? "bg-(--action) text-(--action-fg)"
                  : "border-2 border-(--fg) text-(--fg)"
              }`
            : `${base} h-16 text-(--fg)`;
          return (
            <li key={item.key} className="flex-1">
              <Link
                href={item.href}
                aria-current={current === item.key ? "page" : undefined}
                className={shape}
              >
                <span
                  className={`t-body t-label ${isReport ? "font-bold" : ""}`}
                  style={
                    !isReport && current === item.key
                      ? {
                          textDecoration: "underline",
                          textDecorationThickness: "4px",
                          textUnderlineOffset: "4px",
                          textDecorationColor: "var(--accent-text)",
                        }
                      : undefined
                  }
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
