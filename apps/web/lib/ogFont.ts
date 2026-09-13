import "server-only";

/**
 * A font subset for an Open Graph card, covering exactly the characters on it.
 *
 * Satori ships no CJK glyphs, so the share cards were written around that: the
 * species card leads with the scientific binomial because "a binomial is Latin
 * by definition". True, and it meant a Taiwanese reader sharing 石虎 to LINE saw
 * a preview reading "Prionailurus bengalensis" — accurate, and not the name
 * anyone on the island uses.
 *
 * Bundling a CJK font is the obvious fix and a bad one: Noto Sans TC is several
 * megabytes because it carries thousands of glyphs, and a card needs perhaps
 * forty of them. Google's CSS API takes a `text=` parameter and returns a subset
 * containing only those characters — around 4 KB for a species card, fetched at
 * render time and cached by the platform that requested the image.
 *
 * The User-Agent is load-bearing. Modern ones get woff2, which satori cannot
 * read; an old one gets TrueType, which it can.
 *
 * Returns null on any failure, and every caller must render without it — a link
 * preview is the least important thing on the site and must never be the reason
 * a page fails.
 */
export async function subsetFont(
  text: string,
  weight = 600,
): Promise<{
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600;
  style: "normal";
} | null> {
  const chars = [...new Set(text)].join("");
  if (!chars) return null;

  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@${weight}&text=${encodeURIComponent(chars)}`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1)" },
        signal: AbortSignal.timeout(3000),
      },
    ).then((r) => (r.ok ? r.text() : ""));

    const url = /src:\s*url\((https:[^)]+)\)\s*format\('truetype'\)/.exec(
      css,
    )?.[1];
    if (!url) return null;

    const data = await fetch(url, { signal: AbortSignal.timeout(3000) }).then(
      (r) => (r.ok ? r.arrayBuffer() : null),
    );
    if (!data) return null;

    return {
      name: "Noto Sans TC",
      data,
      weight: weight >= 600 ? 600 : 400,
      style: "normal",
    };
  } catch {
    return null;
  }
}
