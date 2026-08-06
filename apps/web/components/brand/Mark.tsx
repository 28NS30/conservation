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

      {/* Three rows of scales, each offset half a scale so they interlock the way
          real armour does, and drawn back-to-front so each row overlaps the one
          behind it. Lighter toward the front to give the cluster a light source.

          The scales are pointed, not domed. Domes were the first attempt and at
          any size they merged into a pile of eggs — it is the point and the dark
          keyline between neighbours that make this read as armour. */}
      <g className="stroke-bark-900" strokeWidth="1.1">
        {/* back row */}
        <path
          d="M32 10.5 C40.5 15.25, 40.5 24.75, 32 29.5 C23.5 24.75, 23.5 15.25, 32 10.5 Z"
          className="fill-scale-500"
        />
        {/* middle row */}
        <path
          d="M24 20.5 C32.5 25.25, 32.5 34.75, 24 39.5 C15.5 34.75, 15.5 25.25, 24 20.5 Z
             M40 20.5 C48.5 25.25, 48.5 34.75, 40 39.5 C31.5 34.75, 31.5 25.25, 40 20.5 Z"
          className="fill-scale-400"
        />
        {/* front row */}
        <path
          d="M16 30.5 C24.5 35.25, 24.5 44.75, 16 49.5 C7.5 44.75, 7.5 35.25, 16 30.5 Z
             M32 30.5 C40.5 35.25, 40.5 44.75, 32 49.5 C23.5 44.75, 23.5 35.25, 32 30.5 Z
             M48 30.5 C56.5 35.25, 56.5 44.75, 48 49.5 C39.5 44.75, 39.5 35.25, 48 30.5 Z"
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
