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
 * Still today's PNG, which letters 生態守望計畫 / PROJECT ECOWATCH — two names
 * behind. PR2 swaps in the one-time 1040px upscale at `/lab/emblem-1040.png`;
 * showing it soft and out of date is the agreed fallback, because the redraw is
 * on the critical path and the design question cannot wait for it.
 */
export default function Emblem({
  size,
  priority = false,
  sizes,
  className = "",
}: {
  size: number;
  /** Set on the one above the fold, and nowhere else. */
  priority?: boolean;
  sizes?: string;
  className?: string;
}) {
  return (
    <Image
      src={withBase("/brand-badge.png")}
      alt=""
      width={size}
      height={size}
      priority={priority}
      sizes={sizes}
      className={`rounded-full ${className}`}
    />
  );
}
