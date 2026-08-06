/**
 * The compact mark: pangolin scales over a road.
 *
 * NOT a shrunken copy of the badge. The badge carries two rings of text, a
 * pangolin, trees, a road and a car — right for a sticker or a report cover,
 * mud at 28px in a header or 16px in a browser tab.
 *
 * It is also not a small drawing of the animal. Two attempts at that (walking,
 * then curled) both failed the only test that matters: at 24px a hand-drawn
 * quadruped becomes an anonymous lump, and the curled version read as a bean.
 *
 * So the mark is abstract. Overlapping scales are the one feature nothing else
 * shares — no other animal in Taiwan is armoured like this — and a scallop grid
 * survives any size, because it is geometry rather than illustration. The dashed
 * line beneath is the road, which is the whole reason the project exists.
 *
 * The illustrated badge stays for /about, print and stickers, where it has room.
 */
export default function Mark({
  className = "",
  style,
  title,
}: {
  className?: string;
  style?: React.CSSProperties;
  /** Omit inside an already-labelled link; the surrounding text names it. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      style={style}
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
    >
      {title && <title>{title}</title>}

      <circle cx="32" cy="32" r="30" className="fill-bark-800" />
      <circle
        cx="32"
        cy="32"
        r="30"
        className="stroke-parchment-200"
        strokeWidth="2.5"
        fill="none"
      />
      {/* Inner keyline — what makes a badge read as a badge rather than a coin. */}
      <circle
        cx="32"
        cy="32"
        r="25.5"
        className="stroke-parchment-200/30"
        strokeWidth="0.9"
        fill="none"
      />

      {/* Three rows of scales, each row offset half a scale so they interlock the
          way real armour does. Lighter toward the top so the cluster has a light
          source and does not read as flat pattern. */}
      <g>
        {/* back row */}
        <path
          d="M25 30 a7 7 0 0 1 14 0 v3 h-14 z"
          className="fill-scale-500"
        />
        {/* middle row */}
        <path
          d="M18 36 a7 7 0 0 1 14 0 v3 h-14 z M32 36 a7 7 0 0 1 14 0 v3 h-14 z"
          className="fill-scale-400"
        />
        {/* front row */}
        <path
          d="M11.5 42 a7 7 0 0 1 14 0 v3 h-14 z
             M25.5 42 a7 7 0 0 1 14 0 v3 h-14 z
             M39.5 42 a7 7 0 0 1 14 0 v3 h-14 z"
          className="fill-scale-300"
        />
      </g>

      {/* The road. Two dashes at this size, not five — more and they smear. */}
      <path
        d="M14 50.5 h9 M28 50.5 h9 M42 50.5 h8"
        className="stroke-parchment-200/55"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* The badge's rivets, kept because they are its signature. */}
      <circle cx="4.6" cy="32" r="2.1" className="fill-ember-500" />
      <circle cx="59.4" cy="32" r="2.1" className="fill-ember-500" />
    </svg>
  );
}
