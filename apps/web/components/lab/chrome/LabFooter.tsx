import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import Container from "@/components/lab/ui/Container";
import Emblem from "@/components/lab/ui/Emblem";
import { getLabCopy } from "@/lib/lab/copy";
import { labHref, type LabDirection } from "@/lib/lab/directions";

/**
 * Forest, a 160px emblem, and the credit that is a licence condition.
 *
 * The seed records are CC BY 4.0, so naming TaiRON and GBIF is not a courtesy
 * and cannot be dropped for tidiness. It sits at `t-note` — 14px, the floor —
 * beneath links at body size, which is the only hierarchy this block needs.
 *
 * The emblem here is the third of the three allowed per visit (hero, receipt,
 * footer), and the largest thing in it, because a footer is where a stranger
 * looks to find out who is behind a site.
 */
export default async function LabFooter({
  direction,
}: {
  direction: LabDirection;
}) {
  const t = await getTranslations();
  const copy = getLabCopy(await getLocale());

  const links = [
    { href: labHref(direction, "/map"), label: t("nav.map") },
    {
      href: labHref(direction, "/species/28758"),
      label: t("nav.species"),
    },
    { href: "/about", label: t("nav.about") },
    { href: "/attribution", label: t("nav.attribution") },
    { href: "/privacy", label: t("nav.privacy") },
  ];

  return (
    <footer data-surface="field" className="bg-(--ground) text-(--fg)">
      <Container>
        <div className="flex flex-col gap-10 py-16 md:flex-row md:items-start md:justify-between">
          <Emblem size={160} className="h-40 w-40 shrink-0" />
          <div className="md:text-right">
            <ul className="flex flex-col gap-4 md:items-end">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="t-body inline-flex min-h-11 items-center text-(--fg)"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="t-note mt-10 text-(--fg-quiet)">
              {copy.home.sourceLine}
            </p>
          </div>
        </div>
      </Container>
    </footer>
  );
}
