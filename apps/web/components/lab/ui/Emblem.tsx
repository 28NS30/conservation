import Image from "next/image";
import { withBase } from "@/lib/basePath";

/**
 * The badge, big.
 *
 * The owner's one clear instruction is that the emblem should be much larger
 * with very little text beside it, so this is the only image either direction
 * ships: 520px on a desktop hero, 300px on a phone, 160px in a footer or on a
 * receipt, 48px as the header mark. One per viewport.
 *
 * `rounded-full` is the single exemption from the ban on it. The source artwork
 * is a circle on a white field, so without the clip it shows four white corners
 * against cream and reads as a rendering fault rather than a decision.
 *
 * THE ARTWORK IS WRONG AND IS SHOWN ANYWAY. It still letters 生態守望計畫 /
 * PROJECT ECOWATCH, two renames out of date, and `public/brand-badge.png` is
 * 512px — half of what a 520px hero needs on a 2x screen. `/lab/emblem-1040.png`
 * is that same file resampled once to 1040px and committed; it is soft at hero
 * size and it still reads ECOWATCH. That is brief W1's decision 4, taken the
 * agreed way: the redraw is on the critical path and the design question cannot
 * wait for it, so the prototype shows the emblem at the size the design calls
 * for and says out loud that the picture is out of date. `/lab` carries the
 * sentence the owner reads before they open either direction.
 *
 * When the redraw lands it drops in here and nothing else changes.
 */
export default function Emblem({
  size,
  eager = false,
  sizes,
  className = "",
}: {
  size: number;
  /**
   * Set on the one above the fold, and nowhere else.
   *
   * Next 16 deprecated `priority` in favour of `preload`, and its own guidance
   * is to reach for `loading="eager"` with `fetchPriority="high"` before either:
   * the emblem is the hero's only image and is discovered in the first few
   * hundred bytes of the body, so a `<link rel=preload>` in the head buys
   * nothing a high-priority eager fetch does not.
   */
  eager?: boolean;
  sizes?: string;
  className?: string;
}) {
  return (
    <Image
      src={withBase("/lab/emblem-1040.png")}
      alt=""
      width={size}
      height={size}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      sizes={sizes}
      className={`rounded-full ${className}`}
    />
  );
}
