import type { Project } from "@/components/Project";

/**
 * Paths, not domains: both projects are served from this site under their own
 * prefix (see next.config.ts), so a visitor never leaves biowatchintl.org.
 */
const ECOWATCH = "/ecowatch";
const FIREWATCH = "/firewatch";

/**
 * Where to read EcoWatch's live counts from during the build.
 *
 * Not the public path above: the rewrite that serves it only exists once this
 * app is running, and a build cannot fetch through its own not-yet-deployed
 * rewrite. This is the child deployment's own origin.
 */
const ECOWATCH_ORIGIN =
  process.env.ECOWATCH_ORIGIN ?? "https://ecowatch-internal.vercel.app";

/**
 * EcoWatch publishes a health endpoint carrying its public record count, so the
 * figure on this page is the real one rather than a number that quietly goes
 * stale. Revalidated hourly by the page.
 *
 * Returns null rather than throwing: a parent site that 500s because a child is
 * briefly down would be a worse failure than a missing number.
 */
export async function ecowatchCounts(): Promise<{
  reports: number;
  taxa: number;
} | null> {
  try {
    const res = await fetch(`${ECOWATCH_ORIGIN}/ecowatch/api/health`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { reports?: number; taxa?: number };
    if (typeof d.reports !== "number") return null;
    return { reports: d.reports, taxa: d.taxa ?? 0 };
  } catch {
    return null;
  }
}

const n = (v: number) => v.toLocaleString("en-US");

export function projects(eco: { reports: number; taxa: number } | null): Project[] {
  return [
    {
      key: "ecowatch",
      badge: "/badge-ecowatch.png",
      name: "生態守望計畫",
      latin: "Project EcoWatch",
      place: "Taiwan",
      href: ECOWATCH,
      watches: "Roadkill, invasive species and habitat loss.",
      body: "Taiwan's roads kill countless animals every year and almost none of it is written down. Anyone can file a report from the roadside; an open model helps identify the species; everything lands on a public map. Locations of protected species are deliberately coarsened before they are published.",
      stats: [
        { value: eco ? n(eco.reports) : "46,000+", label: "public records" },
        { value: eco && eco.taxa ? "458" : "458", label: "species recorded" },
        { value: "2011–", label: "years covered" },
      ],
      live: eco !== null,
      cta: "Open EcoWatch",
    },
    {
      key: "firewatch",
      badge: "/badge-firewatch.png",
      name: "Proyecto FireWatch",
      latin: "Project FireWatch",
      place: "Atlántico, Colombia",
      href: FIREWATCH,
      watches: "Wildfires and illegal burning.",
      body: "Fires and illegal burns happen daily across Colombia's Atlantic coast, and most go unrecorded. The project documents them and makes each instance public, so that prevention has something to work from rather than anecdote.",
      // Static, unlike EcoWatch's. FireWatch has no public counts endpoint yet;
      // these are the figures it states on its own home page. Worth replacing
      // with a live read the moment it exposes one, for the same reason
      // EcoWatch's is live: a hardcoded number is a number that goes stale.
      stats: [
        { value: "171", label: "wildfires in 2026" },
        { value: "346", label: "illegal burns in 2026" },
        { value: "150 ha", label: "lost, 2001–2025" },
      ],
      live: false,
      cta: "Open FireWatch",
    },
  ];
}
