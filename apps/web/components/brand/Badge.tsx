import Image from "next/image";

/**
 * The full badge: pangolin crossing a road, trees, car, and both name rings.
 *
 * This is the logo. The abstract `Mark` is its reduction, not a replacement —
 * the two rings of type and the pangolin's scales turn to mud below about 48px,
 * which is why anything header-sized still uses Mark. Rule of thumb: Badge at
 * 64px and up, Mark below.
 *
 * `rounded-full` is doing real work. The source artwork is a circle on a white
 * field, so without clipping it shows four white corners against the paper —
 * close enough to the background to look like a rendering fault rather than a
 * deliberate square.
 */
export default function Badge({
  size = 128,
  className = "",
  priority = false,
}: {
  size?: number;
  className?: string;
  /** Set on the one above the fold; leave off elsewhere. */
  priority?: boolean;
}) {
  return (
    <Image
      src="/brand-badge.png"
      alt=""
      width={size}
      height={size}
      priority={priority}
      className={`rounded-full ${className}`}
    />
  );
}
