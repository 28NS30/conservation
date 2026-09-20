"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { COLOURS, type MapColour } from "./mapMode";

/**
 * What the colour on the map means: how many, or what kind.
 *
 * Deliberately a second control rather than three more entries in the display
 * toggle. They are different questions — density says where this is happening,
 * type says what is happening there — and the map is asked both, so two small
 * controls offer six useful views where one list would offer six choices.
 *
 * Two of those six views cannot honour the choice. A kernel density surface has
 * one fixed ramp, and an individual record has no density to express, so it is
 * always drawn by category. The control used to render identically in those
 * states and quietly do nothing when pressed, which is indistinguishable from a
 * bug. It now shows the colour actually in use and says why the other one is
 * unavailable — while leaving the stored preference exactly where the reader
 * left it, so zooming back out or leaving heat mode restores their view rather
 * than a view the map picked for them.
 */
export default function MapColourToggle({
  colour,
  onChange,
  effective = colour,
  locked = null,
  className = "",
}: {
  /** The reader's stored preference. */
  colour: MapColour;
  onChange: (c: MapColour) => void;
  /**
   * What the map is ACTUALLY colouring by. Equal to `colour` wherever both
   * options apply, which is every map that does not pass this.
   */
  effective?: MapColour;
  /**
   * Why the other option cannot apply here, as a sentence to read, or null when
   * both are live. Truthy means locked.
   */
  locked?: string | null;
  className?: string;
}) {
  const t = useTranslations();
  const reasonId = useId();
  return (
    <div
      role="group"
      aria-label={t("map.colourBy")}
      className={`flex rounded-md border border-parchment-200/15 p-0.5 ${className}`}
    >
      {COLOURS.map((c) => {
        const on = effective === c;
        // Neither button writes while the map cannot honour the choice — not
        // even the one that matches what is drawn. Pressing "density" under the
        // heat surface would silently overwrite a stored preference for type
        // that the reader would expect back on the way out.
        const inert = locked !== null;
        // But only the option that genuinely cannot apply is announced as
        // unavailable. `aria-disabled`, never `disabled`: the reader still
        // reaches it by keyboard, still sees a focus ring, and is told why
        // instead of finding a control that has vanished from the tab order.
        const unavailable = inert && !on;
        return (
          <button
            key={c}
            type="button"
            onClick={() => {
              if (!inert) onChange(c);
            }}
            aria-pressed={on}
            {...(unavailable
              ? {
                  "aria-disabled": true,
                  "aria-describedby": reasonId,
                  title: locked,
                }
              : {})}
            className={`flex-1 rounded px-2 py-1 text-[11px] whitespace-nowrap transition ${
              on
                ? "bg-parchment-50/90 font-medium text-bark-950"
                : unavailable
                  ? "cursor-not-allowed text-parchment-500"
                  : "text-parchment-300 hover:bg-parchment-50/10"
            }`}
          >
            {t(`map.colour.${c}`)}
          </button>
        );
      })}
      {locked !== null && (
        <p id={reasonId} className="sr-only">
          {locked}
        </p>
      )}
    </div>
  );
}
