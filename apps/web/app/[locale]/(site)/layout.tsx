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
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-paper-50">
      <SiteHeader variant="page" />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  );
}
