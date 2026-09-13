import type { Project } from "@/components/Project";

/**
 * Each project lives on its own subdomain and deploys independently.
 *
 * Overridable so a preview of this site can point at a project's Vercel URL
 * before DNS is cut over, without editing the copy.
 */
const FORMOSAWATCH =
  process.env.NEXT_PUBLIC_FORMOSAWATCH_URL ??
  "https://formosawatch.biowatchintl.org";
// FlamaWatch is the same Colombian project, renamed. It is run by a separate
// organisation now, so this is a link to someone else's site rather than a
// sibling of this repo — confirm the address with them before launch.
const FLAMAWATCH =
  process.env.NEXT_PUBLIC_FLAMAWATCH_URL ??
  "https://flamawatch.biowatchintl.org";

/**
 * FormosaWatch publishes a health endpoint carrying its public record count, so the
 * figure on this page is the real one rather than a number that quietly goes
 * stale. Revalidated hourly by the page.
 *
 * Returns null rather than throwing: a parent site that 500s because a child is
 * briefly down would be a worse failure than a missing number.
 */
export async function formosawatchCounts(): Promise<{
  reports: number;
  taxa: number;
} | null> {
  try {
    const res = await fetch(`${FORMOSAWATCH}/api/health`, {
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

export function projects(
  habitat: { reports: number; taxa: number } | null,
): Project[] {
  return [
    {
      key: "formosawatch",
      badge: "/badge-formosawatch.png",
      name: "福爾摩沙守望計畫",
      latin: "Project FormosaWatch",
      place: "Taiwan",
      href: FORMOSAWATCH,
      watches: "Roadkill, invasive species and habitat loss.",
      body: "Taiwan's roads kill countless animals every year and almost none of it is written down. Anyone can file a report from the roadside; an open model helps identify the species; everything lands on a public map. Locations of protected species are deliberately coarsened before they are published.",
      stats: [
        {
          value: habitat ? n(habitat.reports) : "46,000+",
          label: "public records",
        },
        {
          value: habitat && habitat.taxa ? "458" : "458",
          label: "species recorded",
        },
        { value: "2011–", label: "years covered" },
      ],
      live: habitat !== null,
      cta: "Open FormosaWatch",
    },
    {
      key: "flamawatch",
      badge: "/badge-flamawatch.png",
      name: "Proyecto FlamaWatch",
      latin: "Project FlamaWatch",
      place: "Atlántico, Colombia",
      href: FLAMAWATCH,
      watches: "Wildfires and illegal burning.",
      body: "Fires and illegal burns happen daily across Colombia's Atlantic coast, and most go unrecorded. The project documents them and makes each instance public, so that prevention has something to work from rather than anecdote.",
      // Static, unlike FormosaWatch's. FlamaWatch has no public counts endpoint yet;
      // these are the figures it states on its own home page. Worth replacing
      // with a live read the moment it exposes one, for the same reason
      // FormosaWatch's is live: a hardcoded number is a number that goes stale.
      stats: [
        { value: "171", label: "wildfires in 2026" },
        { value: "346", label: "illegal burns in 2026" },
        { value: "150 ha", label: "lost, 2001–2025" },
      ],
      live: false,
      cta: "Open FlamaWatch",
    },
  ];
}
