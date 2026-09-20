import type { Project } from "@/components/Project";

/**
 * Each project lives on its own subdomain and deploys independently.
 *
 * Overridable so a preview of this site can point at a project's Vercel URL
 * before DNS is cut over, without editing the copy.
 */
export const FORMOSAWATCH =
  process.env.NEXT_PUBLIC_FORMOSAWATCH_URL ??
  "https://formosawatch.biowatchintl.org";
// FlamaWatch is the same Colombian project, renamed. It is run by a separate
// organisation now, so this is a link to someone else's site rather than a
// sibling of this repo — confirm the address with them before launch.
const FLAMAWATCH =
  process.env.NEXT_PUBLIC_FLAMAWATCH_URL ??
  "https://flamawatch.biowatchintl.org";

/** What came back from FormosaWatch. A null field was not read, not zero. */
export type FormosaCounts = { reports: number | null; species: number | null };

/**
 * FormosaWatch publishes a health endpoint carrying its public record count, so the
 * figure on this page is the real one rather than a number that quietly goes
 * stale. Revalidated hourly by the page.
 *
 * Never throws: a parent site that 500s because a child is briefly down would be
 * a worse failure than a missing number. But it no longer answers a single
 * null either, and it no longer turns a missing `species` into 0. Both of those
 * left the caller unable to tell a live figure from a hardcoded one, which is
 * how this page came to print "450+" as though it had just been measured. Each
 * field is reported separately so each figure can say where it came from.
 */
export async function formosawatchCounts(): Promise<FormosaCounts> {
  const none: FormosaCounts = { reports: null, species: null };
  try {
    const res = await fetch(`${FORMOSAWATCH}/api/health`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return none;
    const d = (await res.json()) as { reports?: number; species?: number };
    // `species` is the count of taxa we hold records for, added to the health
    // endpoint for this card. `taxa` is the whole 125k checklist and was never
    // the right number for a "species recorded" label.
    return {
      reports: typeof d.reports === "number" ? d.reports : null,
      species: typeof d.species === "number" ? d.species : null,
    };
  } catch {
    return none;
  }
}

const n = (v: number) => v.toLocaleString("en-US");

/** The two things a FormosaWatch figure can be, and how each says so. */
const LIVE = "Live from FormosaWatch, refreshed hourly";
const STALE = "Approximate: FormosaWatch could not be reached";
/** When FlamaWatch's figures were read off its home page. */
const FLAMAWATCH_ASOF = "As stated on FlamaWatch's site, 11 Aug 2026";

/**
 * A figure read from FormosaWatch, or the standing approximation if it was not.
 *
 * The note travels with the number. Printing "46,000+" with no note and
 * "46,334" with no note side by side is the failure this replaces: identical
 * typography for a measurement and a guess.
 */
const fromHealth = (live: number | null, approx: string, label: string) => ({
  value: live === null ? approx : n(live),
  label,
  note: live === null ? STALE : LIVE,
});

export function projects(formosa: FormosaCounts): Project[] {
  return [
    {
      key: "formosawatch",
      badge: "/badge-formosawatch.png",
      name: "福爾摩沙守望計畫",
      latin: "Project FormosaWatch",
      place: "Taiwan",
      href: FORMOSAWATCH,
      watches: "Roadkill, invasive species and injured wildlife.",
      body: "Taiwan's roads kill countless animals every year and almost none of it is written down. Anyone can file a report from the roadside, name the animal or leave it to be confirmed, and everything lands on a public map. Locations of protected species are deliberately coarsened before they are published.",
      partner: false,
      stats: [
        fromHealth(formosa.reports, "46,000+", "public records"),
        fromHealth(formosa.species, "450+", "species recorded"),
        {
          // The seed import ends in 2017. An open-ended "2011–" read as "and
          // still arriving", which is true of reports filed here and not of the
          // records this number counts.
          value: "2011–2017",
          label: "years covered",
          note: "Imported from TaiRON (路殺社), CC BY 4.0",
        },
      ],
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
      partner: true,
      // Static, unlike FormosaWatch's. FlamaWatch has no public counts endpoint
      // yet; these are the figures its own home page stated on the day they
      // were copied, which is what the note says, because a number transcribed
      // from someone else's site is only as current as the transcription.
      // Replace with a live read the moment it exposes one.
      stats: [
        { value: "171", label: "wildfires in 2026", note: FLAMAWATCH_ASOF },
        { value: "346", label: "illegal burns in 2026", note: FLAMAWATCH_ASOF },
        { value: "150 ha", label: "lost, 2001–2025", note: FLAMAWATCH_ASOF },
      ],
      cta: "Open FlamaWatch",
    },
  ];
}
