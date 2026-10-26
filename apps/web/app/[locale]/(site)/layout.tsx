import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import SkipLink, { MAIN_CONTENT_ID } from "@/components/site/SkipLink";

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
      <SkipLink />
      <SiteHeader variant="page" />
      {/* The skip link's target. Each page brings its own <main>, so the id
          is on what holds it. Not focusable: following a fragment link moves
          where the next Tab starts from in every current browser, and a
          tabIndex here would make every click on the page's text focus the
          whole page, so that the next Tab started again from its top. */}
      <div id={MAIN_CONTENT_ID} className="flex-1">
        {children}
      </div>
      <SiteFooter />
    </div>
  );
}
