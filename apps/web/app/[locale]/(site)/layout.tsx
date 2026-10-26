import { setRequestLocale } from "next-intl/server";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";

/**
 * Shell for every page that is not the home hero or the full-screen map.
 *
 * A route group `(site)` rather than a path segment: it applies one layout to
 * nine routes without appearing in a single URL. Before this, each inner page
 * carried nothing but a "back to map" link, so the species directory and the
 * statistics read as detached utilities rather than parts of an organisation.
 *
 * `/` keeps its own header because that one is transparent over the hero, and
 * `/map` keeps its own because there the chrome is an instrument panel.
 *
 * The locale is set here as well as in the page, because Next renders a
 * layout apart from the page beneath it. Without it, the header's and the
 * footer's translations asked next-intl for the locale before anything had
 * told it, and next-intl answers that by reading the request's headers: every
 * page under this layout rendered per request, private and no-store, even
 * after the header stopped reading cookies (October 2026).
 */
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper-50">
      <SiteHeader variant="page" />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
