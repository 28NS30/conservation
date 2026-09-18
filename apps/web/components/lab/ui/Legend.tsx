/**
 * What the colours on the map mean, generated from the layer that is actually on.
 *
 * The live map's legend is hand-written per mode and has drifted from the
 * layers three times: it names classes the tiles no longer produce, and at z14
 * it still describes cells when the map is drawing individual records. So this
 * takes the swatches it is given and draws nothing else — the caller reads the
 * live layer, and a legend for a layer that is off cannot be rendered by
 * accident.
 *
 * SWATCH SHAPE EQUALS MARK SHAPE. A square legend beside round dots is worse
 * than no legend, because it is confidently wrong. The dot and ring swatches
 * are drawn round with an inline radius rather than `rounded-full`, which is
 * banned as an interface shape — a data mark is not interface, and matching the
 * map is the whole job.
 */
export type LegendSwatch = {
  /** 1–6, the density ramp. */
  ramp?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Any other `var(--…)`, for the type marks. */
  color?: string;
  shape?: "square" | "dot" | "ring";
  label: React.ReactNode;
};

export default function Legend({
  mode = "steps",
  items = [],
  caption,
  lowLabel,
  highLabel,
  className = "",
}: {
  /** `steps` for grid and dots, `bar` for heat, `marks` for record types. */
  mode?: "steps" | "bar" | "marks";
  items?: LegendSwatch[];
  caption?: React.ReactNode;
  /** The 少 / 多 ends of the heat bar, which carries no numbers. */
  lowLabel?: React.ReactNode;
  highLabel?: React.ReactNode;
  className?: string;
}) {
  const fill = (s: LegendSwatch) =>
    s.color ?? (s.ramp ? `var(--ramp-${s.ramp})` : "transparent");

  const swatch = (s: LegendSwatch, key: number) => (
    <span
      key={key}
      aria-hidden="true"
      className="inline-block h-4 w-4 shrink-0"
      style={{
        ...(s.shape === "ring"
          ? { border: `3px solid ${fill(s)}` }
          : { background: fill(s) }),
        borderRadius: s.shape === "square" || !s.shape ? "0" : "50%",
      }}
    />
  );

  if (mode === "bar") {
    return (
      <div className={`text-(--fg) ${className}`}>
        {caption ? <p className="t-note mb-2">{caption}</p> : null}
        <div className="flex items-center gap-3">
          <span className="t-note">{lowLabel}</span>
          <span
            aria-hidden="true"
            className="h-4 flex-1"
            style={{
              background:
                "linear-gradient(to right, var(--ramp-1), var(--ramp-2), var(--ramp-3), var(--ramp-4), var(--ramp-5), var(--ramp-6))",
            }}
          />
          <span className="t-note">{highLabel}</span>
        </div>
      </div>
    );
  }

  if (mode === "marks") {
    return (
      <ul className={`flex flex-wrap gap-x-6 gap-y-2 text-(--fg) ${className}`}>
        {caption ? (
          <li className="t-note basis-full">{caption}</li>
        ) : null}
        {items.map((item, i) => (
          <li key={i} className="t-note flex items-center gap-2">
            {swatch(item, i)}
            {item.label}
          </li>
        ))}
      </ul>
    );
  }

  // Contiguous swatches with their break numbers beneath, so the steps read as
  // one scale rather than six separate keys.
  return (
    <div className={`text-(--fg) ${className}`}>
      {caption ? <p className="t-note mb-2">{caption}</p> : null}
      <ul className="flex">
        {items.map((item, i) => (
          <li key={i} className="flex-1">
            <span
              aria-hidden="true"
              className="block h-4 w-full"
              style={{ background: fill(item) }}
            />
            <span className="t-note mt-1 block">{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
