import { withBase } from "@/lib/basePath";
import { LAB_FONT_PRELOAD } from "@/lib/lab/fonts";
import type { LabDirection } from "@/lib/lab/directions";

/**
 * Fetch the direction's display face before the browser has read the CSS.
 *
 * ON THE HOME PAGE AND NOWHERE ELSE. This is the one route where the typeface
 * IS the first impression — a 300px emblem, the project's name at 80px, and
 * almost nothing else — so it is the one route worth spending a round trip on
 * before layout. Put it in a layout instead and every page under that layout
 * pays, including the map, whose whole budget is that it asks for no font.
 *
 * It also covers the only real cost of `font-display: swap`. Without a preload
 * the browser finds the face while parsing the CSS, paints the hero in the
 * system stack, and reflows it when the subset arrives; the acceptance bar is
 * CLS under 0.05 and a reflowed 80px heading is most of that on its own. With
 * one, the 55 KB face is usually in hand before the first paint.
 *
 * Only the `home` face, never `ui` or `names`: `unicode-range` already tells
 * the browser which file a character needs, so preloading the others would
 * fetch 270 KB to draw nothing.
 *
 * `crossOrigin` is not optional even though the file is same-origin. Fonts are
 * fetched in CORS mode, and a preload without it is a second, separate fetch
 * rather than a warm cache entry — the mistake shows up as the font arriving
 * twice and the preload being reported as unused.
 */
export default function LabFontPreload({
  direction,
}: {
  direction: LabDirection;
}) {
  return (
    <link
      rel="preload"
      as="font"
      type="font/woff2"
      href={withBase(LAB_FONT_PRELOAD[direction])}
      crossOrigin="anonymous"
    />
  );
}
